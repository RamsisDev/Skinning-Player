import { describe, expect, it } from 'vitest';
import { embeddedTags, parseDate } from './embedded-tags.ts';

const bytes = (...parts: (string | number[] | Uint8Array)[]): Uint8Array => {
  const chunks = parts.map((part) =>
    typeof part === 'string' ? Uint8Array.from(part, (c) => c.charCodeAt(0)) : Uint8Array.from(part),
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};
const utf8 = (text: string) => new TextEncoder().encode(text);
const utf16le = (text: string) => bytes([0xff, 0xfe], Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0])));
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const uint32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const uint32le = (n: number) => uint32(n).reverse();

const tagsOf = (file: Uint8Array) =>
  embeddedTags({ size: file.length, read: (offset, length) => file.subarray(offset, offset + length) });

/** An ID3v2 tag of the given version, from frames already laid out. */
const id3 = (version: 2 | 3 | 4, ...frames: Uint8Array[]) => {
  const body = bytes(...frames);
  return bytes('ID3', [version, 0, 0], syncsafe(body.length), body);
};
const frame23 = (id: string, body: Uint8Array) => bytes(id, uint32(body.length), [0, 0], body);
const frame24 = (id: string, body: Uint8Array) => bytes(id, syncsafe(body.length), [0, 0], body);
const latin1Text = (text: string) => bytes([0], text);
const mpegFrame = bytes([0xff, 0xfb, 0x90, 0x64], new Uint8Array(400));

/** The 128-byte ID3v1 tag at the end of an MP3, its fields padded with zeros. */
const id3v1 = (fields: { title?: string; artist?: string; album?: number[] | string; year?: string; genre?: number }) => {
  const field = (value: number[] | string | undefined, width: number) => {
    const raw = typeof value === 'string' ? bytes(value) : Uint8Array.from(value ?? []);
    const out = new Uint8Array(width);
    out.set(raw.subarray(0, width));
    return out;
  };
  return bytes('TAG', field(fields.title, 30), field(fields.artist, 30), field(fields.album, 30), field(fields.year, 4), new Uint8Array(30), [fields.genre ?? 255]);
};

/** Vorbis comments: a vendor, then each `KEY=value` after its length. */
const comments = (...entries: string[]) =>
  bytes(uint32le(6), 'vendor', uint32le(entries.length), ...entries.flatMap((entry) => [uint32le(utf8(entry).length), utf8(entry)]));

const box = (type: string, ...children: (string | number[] | Uint8Array)[]) => {
  const body = bytes(...children);
  return bytes(uint32(8 + body.length), type, body);
};
const mp4Text = (type: string, text: string) => box(type, box('data', uint32(1), uint32(0), utf8(text)));

/** Ogg pages laying out the packets, at most `perPage` segments to a page. */
const oggPages = (packets: Uint8Array[], perPage: number) => {
  const segments: Uint8Array[] = [];
  for (const packet of packets) {
    let at = 0;
    while (packet.length - at >= 255) {
      segments.push(packet.subarray(at, at + 255));
      at += 255;
    }
    segments.push(packet.subarray(at));
  }
  const pages: Uint8Array[] = [];
  for (let i = 0; i < segments.length; i += perPage) {
    const page = segments.slice(i, i + perPage);
    pages.push(bytes('OggS', [0, 0], new Uint8Array(8), uint32le(1), uint32le(pages.length), uint32le(0), [page.length], page.map((s) => s.length), ...page));
  }
  return bytes(...pages);
};

describe('embeddedTags', () => {
  it('reads the text frames of a 2.3 tag in Latin-1 and UTF-16, past its picture', () => {
    const file = bytes(
      id3(
        3,
        frame23('TIT2', latin1Text('Café Tacvba')),
        frame23('APIC', bytes([0], 'image/jpeg', [0], [3], [0], new Uint8Array(2000))),
        frame23('TPE1', bytes([1], utf16le('Juanes'), [0, 0])),
        frame23('TALB', latin1Text('Un Día Normal')),
        frame23('TCON', latin1Text('(17)')),
        frame23('TYER', latin1Text('2002')),
        frame23('COMM', latin1Text('ignored')),
      ),
      mpegFrame,
    );
    expect(tagsOf(file)).toEqual({ title: 'Café Tacvba', artists: ['Juanes'], album: 'Un Día Normal', genres: ['Rock'], date: '2002' });
  });

  it('keeps each value of a 2.4 field, and the whole of a full date', () => {
    const file = bytes(
      id3(
        4,
        frame24('TIT2', bytes([3], utf8('Amárrame'))),
        frame24('TPE1', bytes([3], utf8('Mon Laferte\0Juanes'))),
        frame24('TCON', bytes([3], utf8('13\0Latin'))),
        frame24('TDRC', bytes([3], utf8('2017-03-01'))),
      ),
      mpegFrame,
    );
    expect(tagsOf(file)).toEqual({ title: 'Amárrame', artists: ['Mon Laferte', 'Juanes'], genres: ['Pop', 'Latin'], date: '2017-03-01' });
  });

  it('reads the album artist, and the three-letter frames of 2.2', () => {
    const frame22 = (id: string, body: Uint8Array) => bytes(id, [0, 0, body.length], body);
    const file = bytes(id3(2, frame22('TT2', latin1Text('Rapture')), frame22('TP2', latin1Text('Blondie'))), mpegFrame);
    expect(tagsOf(file)).toEqual({ title: 'Rapture', albumArtists: ['Blondie'] });
  });

  it('fills what the ID3v2 tag leaves out from the ID3v1 tag, reading UTF-8 written as Latin-1', () => {
    const file = bytes(
      id3(3, frame23('TIT2', latin1Text('From v2'))),
      mpegFrame,
      id3v1({ title: 'From v1', artist: 'Soda Stereo', album: [...utf8('Canción Animal')], year: '1990', genre: 17 }),
    );
    expect(tagsOf(file)).toEqual({ title: 'From v2', artists: ['Soda Stereo'], album: 'Canción Animal', genres: ['Rock'], date: '1990' });
    expect(tagsOf(bytes(mpegFrame, id3v1({ artist: 'Maná' })))).toEqual({ artists: ['Maná'] });
  });

  it('reads the comments block of a FLAC, keeping both of an artist named twice', () => {
    const block = comments('TITLE=Vivir sin aire', 'artist=Maná', 'ARTIST=Guest', 'DATE=1992', 'GENRE=Rock en Español');
    const file = bytes('fLaC', [0], uint32(34).slice(1), new Uint8Array(34), [0x84], uint32(block.length).slice(1), block);
    expect(tagsOf(file)).toEqual({ title: 'Vivir sin aire', artists: ['Maná', 'Guest'], genres: ['Rock en Español'], date: '1992' });
  });

  it('reads the ReplayGain a tagger wrote, in an ID3 tag, FLAC comments or Opus R128 gains', () => {
    const txxx = (description: string, value: string) => frame24('TXXX', bytes([3], utf8(`${description}\0${value}`)));
    const mp3 = bytes(id3(4, txxx('replaygain_track_gain', '-7.89 dB'), txxx('REPLAYGAIN_ALBUM_GAIN', '+1.20 dB')), mpegFrame);
    expect(tagsOf(mp3)).toEqual({ replayGain: { track: -7.89, album: 1.2 } });

    const block = comments('REPLAYGAIN_TRACK_GAIN=-3.5 dB');
    const flac = bytes('fLaC', [0], uint32(34).slice(1), new Uint8Array(34), [0x84], uint32(block.length).slice(1), block);
    expect(tagsOf(flac)).toEqual({ replayGain: { track: -3.5 } });

    // -2560 is -10 dB toward -23 LUFS, which is -5 dB toward ReplayGain's -18.
    const opus = oggPages([bytes('OpusHead', new Uint8Array(11)), bytes('OpusTags', comments('R128_TRACK_GAIN=-2560'))], 1);
    expect(tagsOf(opus)).toEqual({ replayGain: { track: -5 } });
  });

  it('gathers the comments of an Opus stream from the pages that carry them', () => {
    const head = bytes('OpusHead', new Uint8Array(11));
    const tags = bytes('OpusTags', comments(`TITLE=${'Long '.repeat(80).trim()}`, 'ARTIST=Zoé', 'ALBUM=Reptilectric'));
    const tagsResult = tagsOf(oggPages([head, tags, bytes('audio')], 1));
    expect(tagsResult).toMatchObject({ artists: ['Zoé'], album: 'Reptilectric' });
    expect(tagsResult.title).toHaveLength(399);
  });

  it('reads the iTunes atoms of an M4A, with its genre given as a number', () => {
    const file = bytes(
      box('ftyp', 'M4A ', uint32(0)),
      box('mdat', new Uint8Array(100)),
      box(
        'moov',
        box('mvhd', new Uint8Array(20)),
        box(
          'udta',
          box(
            'meta',
            uint32(0),
            box('hdlr', new Uint8Array(20)),
            box('ilst', mp4Text('©nam', 'Eres'), mp4Text('aART', 'Café Tacvba'), mp4Text('©day', '2003-01-01T08:00:00Z'), box('gnre', box('data', uint32(0), uint32(0), [0, 18]))),
          ),
        ),
      ),
    );
    expect(tagsOf(file)).toEqual({ title: 'Eres', albumArtists: ['Café Tacvba'], genres: ['Rock'], date: '2003-01-01' });
  });

  it('prefers the id3 chunk of a WAV over its LIST INFO chunk, which fills the rest', () => {
    const info = bytes('INFO', 'INAM', uint32le(5), 'Info', [0], [0], 'IPRD', uint32le(6), 'Album', [0]);
    const tag = id3(3, frame23('TIT2', latin1Text('Tagged')));
    const file = bytes('RIFF', uint32le(0), 'WAVE', 'LIST', uint32le(info.length), info, 'data', uint32le(4), [1, 2, 3, 4], 'id3 ', uint32le(tag.length), tag);
    expect(tagsOf(file)).toEqual({ title: 'Tagged', album: 'Album' });
  });

  it('answers nothing for a file with no tags', () => {
    expect(tagsOf(mpegFrame)).toEqual({});
    expect(tagsOf(new Uint8Array(0))).toEqual({});
  });

  it('reads the track and disc, album artist, original date, release type and sort names of a 2.4 tag', () => {
    const text = (value: string) => bytes([3], utf8(value));
    const file = bytes(
      id3(
        4,
        frame24('TIT2', text('Bohemian Rhapsody')),
        frame24('TPE1', text('Queen')),
        frame24('TPE2', text('Queen')),
        frame24('TRCK', text('11/12')),
        frame24('TPOS', text('1/2')),
        frame24('TDRC', text('2011-03-14')),
        frame24('TDOR', text('1975-10-31')),
        frame24('TXXX', text('MusicBrainz Album Type\0album\0live')),
        frame24('TXXX', text('ignored description\0value')),
        frame24('TSOP', text('Queen, The')),
        frame24('TSOT', text('Bohemian')),
        frame24('TCMP', text('1')),
      ),
      mpegFrame,
    );
    expect(tagsOf(file)).toEqual({
      title: 'Bohemian Rhapsody',
      artists: ['Queen'],
      albumArtists: ['Queen'],
      track: 11,
      disc: 1,
      date: '2011-03-14',
      originalDate: '1975-10-31',
      releaseTypes: ['album', 'live'],
      artistSort: 'Queen, The',
      titleSort: 'Bohemian',
      compilation: true,
    });
  });

  it('refines a 2.3 year by its day and month, and reads the track number of an ID3v1.1 tag', () => {
    const file = bytes(id3(3, frame23('TYER', latin1Text('1997')), frame23('TDAT', latin1Text('2105'))), mpegFrame);
    expect(tagsOf(file)).toEqual({ date: '1997-05-21' });
    const v11 = id3v1({ title: 'Track' });
    v11[3 + 30 + 30 + 30 + 4 + 28] = 0;
    v11[3 + 30 + 30 + 30 + 4 + 29] = 7;
    expect(tagsOf(bytes(mpegFrame, v11))).toEqual({ title: 'Track', track: 7 });
  });

  it('reads the numbers, album artist, original date and release type of FLAC comments', () => {
    const block = comments(
      'TITLE=Clocks',
      'TRACKNUMBER=05',
      'DISCNUMBER=1',
      'ALBUMARTIST=Coldplay',
      'ORIGINALDATE=2002',
      'RELEASETYPE=single',
      'ALBUMARTISTSORT=Coldplay',
    );
    const file = bytes('fLaC', [0x84], uint32(block.length).slice(1), block);
    expect(tagsOf(file)).toEqual({
      title: 'Clocks',
      track: 5,
      disc: 1,
      albumArtists: ['Coldplay'],
      originalDate: '2002',
      releaseTypes: ['single'],
      albumArtistSort: 'Coldplay',
    });
  });

  it('reads the track and disc numbers, compilation flag, sort names and freeform fields of an M4A', () => {
    const freeform = (name: string, value: string) =>
      box('----', box('mean', uint32(0), 'com.apple.iTunes'), box('name', uint32(0), name), box('data', uint32(1), uint32(0), utf8(value)));
    const number = (type: string, n: number) => box(type, box('data', uint32(0), uint32(0), [0, 0, 0, n, 0, 12, 0, 0]));
    const file = bytes(
      box('ftyp', 'M4A ', uint32(0)),
      box(
        'moov',
        box(
          'udta',
          box(
            'meta',
            uint32(0),
            box(
              'ilst',
              mp4Text('©nam', 'Song'),
              number('trkn', 4),
              number('disk', 2),
              box('cpil', box('data', uint32(21), uint32(0), [1])),
              mp4Text('soar', 'Beatles'),
              freeform('MusicBrainz Album Type', 'ep'),
              freeform('ORIGINALDATE', '1963-03-22'),
            ),
          ),
        ),
      ),
    );
    expect(tagsOf(file)).toEqual({
      title: 'Song',
      track: 4,
      disc: 2,
      compilation: true,
      artistSort: 'Beatles',
      releaseTypes: ['ep'],
      originalDate: '1963-03-22',
    });
  });
});

describe('parseDate', () => {
  it('keeps a date as precise as it is written, and drops what is not a date', () => {
    expect(parseDate('2004')).toBe('2004');
    expect(parseDate('2004-05')).toBe('2004-05');
    expect(parseDate('2004-05-12T10:00:00Z')).toBe('2004-05-12');
    expect(parseDate('2004/05/12')).toBe('2004-05-12');
    expect(parseDate('20040512')).toBe('2004-05-12');
    expect(parseDate('2004-13-01')).toBe('2004');
    expect(parseDate('0000')).toBeUndefined();
    expect(parseDate('soon')).toBeUndefined();
  });
});
