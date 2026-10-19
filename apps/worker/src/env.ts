export type Env = {
  [K in keyof CloudflareBindings]: CloudflareBindings[K] extends string ? string : CloudflareBindings[K];
} & {
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
  DEMO_PROVIDER_SECRET: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  BANK_ENABLED?: string;
  /** Explicit isolated regression fixture; never configure in a deployed application. */
  BANK_LEGACY_PAYMENT_FIXTURE?: string;
  BANK_DEPLOYMENT?: string;
  BANK_RPC_URL?: string;
  BANK_MARKETPLACE_FEE_BPS?: string;
  PRIVY_APP_ID?: string;
  PRIVY_APP_SECRET?: string;
  PRIVY_WALLET_ID?: string;
  BANK_PLANNER_API_KEY?: string;
  BANK_PLANNER_MODEL?: string;
};
export type AppEnv = {
  Bindings: Env;
  Variables: { userId: string; userEmail: string; correlationId: string };
};
