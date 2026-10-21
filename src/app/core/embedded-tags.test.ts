import { describe, expect, it } from 'vitest';
import { embeddedTags } from './embedded-tags.ts';

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
    expect(tagsOf(file)).toEqual({ title: 'Café Tacvba', artist: 'Juanes', album: 'Un Día Normal', genre: 'Rock', year: '2002' });
  });

  it('joins the values of a 2.4 field, and keeps the year of a full date', () => {
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
    expect(tagsOf(file)).toEqual({ title: 'Amárrame', artist: 'Mon Laferte, Juanes', genre: 'Pop, Latin', year: '2017' });
  });

  it('falls back to the album artist, and reads the three-letter frames of 2.2', () => {
    const frame22 = (id: string, body: Uint8Array) => bytes(id, [0, 0, body.length], body);
    const file = bytes(id3(2, frame22('TT2', latin1Text('Rapture')), frame22('TP2', latin1Text('Blondie'))), mpegFrame);
    expect(tagsOf(file)).toEqual({ title: 'Rapture', artist: 'Blondie' });
  });

  it('fills what the ID3v2 tag leaves out from the ID3v1 tag, reading UTF-8 written as Latin-1', () => {
    const file = bytes(
      id3(3, frame23('TIT2', latin1Text('From v2'))),
      mpegFrame,
      id3v1({ title: 'From v1', artist: 'Soda Stereo', album: [...utf8('Canción Animal')], year: '1990', genre: 17 }),
    );
    expect(tagsOf(file)).toEqual({ title: 'From v2', artist: 'Soda Stereo', album: 'Canción Animal', genre: 'Rock', year: '1990' });
    expect(tagsOf(bytes(mpegFrame, id3v1({ artist: 'Maná' })))).toEqual({ artist: 'Maná' });
  });

  it('reads the comments block of a FLAC, joining an artist named twice', () => {
    const block = comments('TITLE=Vivir sin aire', 'artist=Maná', 'ARTIST=Guest', 'DATE=1992', 'GENRE=Rock en Español');
    const file = bytes('fLaC', [0], uint32(34).slice(1), new Uint8Array(34), [0x84], uint32(block.length).slice(1), block);
    expect(tagsOf(file)).toEqual({ title: 'Vivir sin aire', artist: 'Maná, Guest', genre: 'Rock en Español', year: '1992' });
  });

  it('gathers the comments of an Opus stream from the pages that carry them', () => {
    const head = bytes('OpusHead', new Uint8Array(11));
    const tags = bytes('OpusTags', comments(`TITLE=${'Long '.repeat(80).trim()}`, 'ARTIST=Zoé', 'ALBUM=Reptilectric'));
    const tagsResult = tagsOf(oggPages([head, tags, bytes('audio')], 1));
    expect(tagsResult).toMatchObject({ artist: 'Zoé', album: 'Reptilectric' });
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
    expect(tagsOf(file)).toEqual({ title: 'Eres', artist: 'Café Tacvba', genre: 'Rock', year: '2003' });
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
});
