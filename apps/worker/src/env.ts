export type Env = {
  [K in keyof CloudflareBindings]: CloudflareBindings[K] extends string ? string : CloudflareBindings[K];
} & {
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
  DASHBOARD_PASSWORD: string;
  DEMO_PROVIDER_SECRET: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
};
export type AppEnv = { Bindings: Env; Variables: { userId: string; correlationId: string } };
