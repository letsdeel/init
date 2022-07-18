import { Logger } from 'pino';
import * as Sentry from '@sentry/node';
type Sentry = typeof Sentry

declare global {
  const log: Logger;
  const asyncContext: any;
  const __DEV__: 'development' | 'production'
  const Sentry: Sentry
}
export {};