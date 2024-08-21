import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import http, { type Server } from 'http';
import { app_config } from './config/app.config';
import { logger } from './logger';

export class HealthCheckServer {
  private static app: Express | null = null;
  private static server: Server | null = null;
  private static activeConnections = 0;

  private static readonly PORT = app_config.healthCheckPort || 3000;
  private static readonly MAX_REQUESTS_PER_SECOND = 5;
  private static readonly MAX_SIMULTANEOUS_CONNECTIONS = 5;

  private static initialize = (): void => {
    if (this.app) return; // Ensure server is initialized only once

    const app = express();
    this.app = app;

    app.use(
      rateLimit({
        windowMs: 1000, // 1 second window
        max: this.MAX_REQUESTS_PER_SECOND,
        message: 'Too many requests, please try again later.',
      }),
    );

    app.use(this.connectionLimiter);

    app.get('/health', this.healthCheckHandler);
  };

  private static connectionLimiter = (_req: Request, res: Response, next: NextFunction): void => {
    if (this.activeConnections >= this.MAX_SIMULTANEOUS_CONNECTIONS) {
      res.status(503).json({ error: 'Server is busy, please try again later.' });
    }

    this.activeConnections++;
    res.on('finish', () => {
      this.activeConnections--;
    });

    next();
  };

  private static healthCheckHandler = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'ok' });
  };

  // Start the server
  public static start = (): void => {
    if (!this.server) {
      this.initialize();

      if (!this.app) {
        logger.error('Health Check Server initialization failed.');
        return;
      }

      this.server = http.createServer(this.app);

      this.server.listen(this.PORT, () => {
        logger.info(`Health Check Server is running on http://localhost:${this.PORT}`);
      });
    }
  };

  // Stop the server
  public static stop = async (): Promise<void> => {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Health Check Server has been stopped.');
          this.server = null; // Reset server to null
          resolve();
        });
      }
    });
  };
}
