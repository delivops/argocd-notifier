import { ResourceEventType } from '@/enums/resource-event-type.enum';
import type { Logger } from '@/interfaces/logger.interface';
import type { MyCustomResource } from '@/interfaces/my-custom-resource.interface';
import type { MyResourceEvent } from '@/interfaces/my-resource-event.interface';
import { KubeConfig, Watch } from '@kubernetes/client-node';
import Async from 'async';
import { DEFAULT_BACK_OFF_FACTOR, DEFAULT_MAX_RESTART_TIMEOUT, DEFAULT_RESTART_TIMEOUT } from './config';

type OnEventCallback = (event: MyResourceEvent) => Promise<void> | void;
type OnFailCallback = (err: unknown) => Promise<void> | void;
type EventQueueObject = { event: MyResourceEvent; onEvent: OnEventCallback };

const silentLogger: Logger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
};

export abstract class CustomResourceOperator {
  private readonly kubeConfig: KubeConfig;

  private readonly abortControllers: AbortController[] = [];
  private readonly eventQueue: Async.QueueObject<EventQueueObject>;

  constructor(
    protected readonly logger: Logger = silentLogger,
    private readonly restartTimeout: number = DEFAULT_RESTART_TIMEOUT,
    private readonly backOffFactor: number = DEFAULT_BACK_OFF_FACTOR,
    private readonly maxRestartTimeout: number = DEFAULT_MAX_RESTART_TIMEOUT,
  ) {
    this.kubeConfig = new KubeConfig();
    this.kubeConfig.loadFromDefault();

    this.eventQueue = Async.queue((args) => args.onEvent(args.event));
  }

  public async start(): Promise<void> {
    this.logger.info('Starting the operator...');
    try {
      await this.init();
    } catch (error) {
      this.logger.error(`Failed to initialize the operator: ${JSON.stringify(error, null, 2)}`);
      throw error;
    }
  }

  public stop(): void {
    this.logger.info('Stopping the operator...');
    this.abortControllers.forEach((controller) => controller.abort());
    this.abortControllers.length = 0; // Clear the array
    this.eventQueue.kill();
  }

  // *
  // * This method mus be implemented in the derived class
  // *
  protected abstract init(): Promise<void>;

  /**
   * Watches a Kubernetes resource and handles events with the provided callback.
   * Automatically retries watching with exponential backoff on failure.
   *
   * @param group The API group of the resource.
   * @param version The API version of the resource.
   * @param plural The plural name of the resource to watch.
   * @param onEvent Callback function to handle resource events.
   * @param onFail Callback function to handle errors.
   * @param namespace (Optional) Namespace for namespaced resources; if omitted, watches cluster-wide.
   */
  protected async watchResource(
    group: string,
    version: string,
    plural: string,
    onEvent: OnEventCallback,
    onFail: OnFailCallback,
    namespace?: string,
  ): Promise<void | never> {
    const resourceId = `${plural}.${group ? `${group}/` : ''}${version}`;
    const scope = namespace ? `namespace '${namespace}'` : 'cluster';
    const path = namespace
      ? `/apis/${group}/${version}/namespaces/${namespace}/${plural}`
      : `/apis/${group}/${version}/${plural}`;

    const watcher = new Watch(this.kubeConfig);

    const onWatchEvent = async (phase: string, apiObj: unknown, _watchObj?: unknown) => {
      const type = Object.values(ResourceEventType).find((type) => type === phase);
      if (!type) {
        this.logger.warn(`Unknown event type '${phase}' received`);
        return;
      }
      await this.eventQueue.push({ event: { type, object: apiObj as MyCustomResource }, onEvent });
    };

    let restartDelay = this.restartTimeout;

    const onWatchError = async (err?: unknown) => {
      if (err) {
        this.logger.error(`Error watching '${resourceId}' in ${scope}: ${JSON.stringify(err, null, 2)}`);
      }
      await onFail(err);
      // Delay before attempting to restart watch after a failure.
      setTimeout(restartWatch, restartDelay);
      restartDelay = Math.min(restartDelay * this.backOffFactor, this.maxRestartTimeout); // Exponential backoff with a maximum timeout
    };

    const restartWatch = async () => {
      try {
        const abortController = new AbortController();
        await watcher.watch(path, { signal: abortController.signal }, onWatchEvent, onWatchError);
        this.abortControllers.push(abortController);

        this.logger.info(`Watching resource '${resourceId}' in ${scope}...`);
      } catch (err) {
        this.logger.error(`Failed to (re)start watch for '${resourceId}' in ${scope}:`, err);
        await onWatchError();
      }
    };

    await restartWatch();
  }
}
