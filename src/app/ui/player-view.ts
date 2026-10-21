import { Service, signal } from '@angular/core';

/** Whether the full player is showing: opened by a tap on a song or on the mini player. */
@Service()
export class PlayerView {
  readonly open = signal(false);

  show(): void {
    this.open.set(true);
  }

  hide(): void {
    this.open.set(false);
  }
}
