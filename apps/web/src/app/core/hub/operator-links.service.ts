import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../api/api.service';
import type { OperatorLinks } from '../models';

/**
 * The portal's sign-in page and the service's top-up page, read once per
 * session: they come from the server configuration and do not change while the
 * portal runs. Empty until loaded, and empty for good when the read fails, in
 * which case the screens simply leave the link out.
 */
@Injectable({ providedIn: 'root' })
export class OperatorLinksService {
  private readonly api = inject(ApiService);
  private pending: Promise<void> | null = null;

  readonly links = signal<OperatorLinks | null>(null);

  load(): Promise<void> {
    this.pending ??= firstValueFrom(this.api.get<OperatorLinks>('/admin/overview/links')).then(
      (links) => this.links.set(links),
      () => {
        // Try again the next time a screen asks.
        this.pending = null;
      },
    );
    return this.pending;
  }
}
