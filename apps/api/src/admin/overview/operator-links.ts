import type { AppConfig } from '../../config/env.js';

export interface OperatorLinks {
  /** The portal's own sign-in page: where a mail to a customer of this portal should point. */
  portalLogin: string;
  /**
   * The page of the service where the operator buys credit. Payments stay with
   * the service; the portal never forwards one (see admin-allowlist.ts), so a
   * screen that runs out of credit can only send the operator there.
   */
  topUp: string;
}

/** Both addresses come from the configuration, never from a request. */
export function operatorLinks(config: Pick<AppConfig, 'appUrl' | 'echocall'>): OperatorLinks {
  return {
    portalLogin: `${config.appUrl}/login`,
    topUp: `${new URL(config.echocall.apiUrl).origin}/reseller/credits`,
  };
}
