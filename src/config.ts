export interface Config {
  port: number;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    maxConnections: number;
  };
  nodeEnv: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    database: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'metering',
      password: process.env.DB_PASSWORD || 'metering_pass',
      database: process.env.DB_NAME || 'metering',
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
    },
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}

export const config = loadConfig();
