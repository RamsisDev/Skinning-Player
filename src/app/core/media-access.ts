import { Service, inject } from '@angular/core';
import { MediaLibrary } from '@ng-native/expo/media-library';

export type Access = 'granted' | 'denied' | 'blocked';

/**
 * Access to one kind of media: the music, or the images a folder cover is. `MediaLibrary.permission`
 * asks the module about every kind the manifest declares, so once the app declares images too it
 * reads as refused while only the music is allowed. This asks about the kind it is given alone.
 */
@Service()
export class MediaAccess {
  private readonly native = inject(MediaLibrary.SOURCE);

  /** Asks for access when it is not granted yet. Android answers at once, without a dialog, when it is off for good. */
  async ensure(kind: 'audio' | 'photo'): Promise<Access> {
    // Without the module, as in Expo Go, nothing the user does can grant it.
    if (!this.native) return 'blocked';
    let answer = await this.native.getPermissionsAsync(false, [kind]);
    if (!answer.granted) answer = await this.native.requestPermissionsAsync(false, [kind]);
    if (answer.granted) return 'granted';
    return answer.canAskAgain ? 'denied' : 'blocked';
  }
}
