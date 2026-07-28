// Badge earn-window parsing and live/upcoming/expired classification, shared by
// the gallery, the detail panel and the drop toast.
//
// Windows arrive either as ISO timestamps (Drops campaigns) or as hand-written
// prose ("Dec 19 – Jan 01", "December 4, 2025 at 9:00 AM"). Status is derived at
// render time, so a badge whose window opens while its payload sits in a cache
// still reads correctly.

export type BadgeWindowStatus = 'available' | 'coming-soon' | 'expired';

export interface BadgeWindow {
  start: Date;
  end: Date;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3,
  May: 4, Jun: 5, Jul: 6, Aug: 7,
  Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const FULL_MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3,
  May: 4, June: 5, July: 6, August: 7,
  September: 8, October: 9, November: 10, December: 11,
};

// Regular dash, en-dash, em-dash. Sources use all three interchangeably.
const DASH = '[-–—]';

// Badge copy writes months both ways ("Dec 6" and "December 6") and often adds
// an ordinal suffix ("July 26th"). Ranges are joined by a dash, by "to", by
// "through", or by "between X and Y".
const MONTH_WORD = '([A-Za-z]{3,9})';
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const JOIN = `(?:\\s*${DASH}\\s*|\\s+(?:to|through|until)\\s+|\\s+and\\s+)`;

/** Month index from either an abbreviation or a full name. */
function monthNum(name: string): number | undefined {
  if (!name) return undefined;
  const key = name.toLowerCase();
  for (const [full, idx] of Object.entries(FULL_MONTHS)) {
    if (full.toLowerCase() === key) return idx;
  }
  for (const [abbr, idx] of Object.entries(MONTHS)) {
    if (abbr.toLowerCase() === key) return idx;
  }
  // "Sept" and other 4-letter forms of a 3-letter abbreviation.
  for (const [full, idx] of Object.entries(FULL_MONTHS)) {
    if (key.length >= 3 && full.toLowerCase().startsWith(key)) return idx;
  }
  return undefined;
}

const ISO_STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z?`;

/** Scraped copy arrives with entities intact, which breaks the dash regexes. */
export function decodeHtmlEntities(text: string): string {
  let result = text;

  result = result.replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)));
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
  };
  for (const [entity, char] of Object.entries(entities)) {
    result = result.split(entity).join(char);
  }
  return result;
}

function bothValid(start: Date, end: Date): BadgeWindow | null {
  return !isNaN(start.getTime()) && !isNaN(end.getTime()) ? { start, end } : null;
}

/**
 * Pull an earn window out of free-form badge copy. Ordered most specific first:
 * an explicit "Event duration" line beats a bare range found anywhere in the
 * prose, and a form carrying a year beats one that must assume the current year.
 */
export function parseDateRange(inputText: string): BadgeWindow | null {
  const text = decodeHtmlEntities(inputText);
  const currentYear = new Date().getFullYear();

  // "Event duration: December 6, 2025 – December 7, 2025" (full month, no time)
  const fullNamedRange = text.match(
    new RegExp(
      String.raw`Event duration:\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})\s*${DASH}\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})`,
      'i'
    )
  );
  if (fullNamedRange) {
    const [, sName, sDay, sYear, eName, eDay, eYear] = fullNamedRange;
    if (Object.hasOwn(FULL_MONTHS, sName) && Object.hasOwn(FULL_MONTHS, eName)) {
      const window = bothValid(
        new Date(parseInt(sYear, 10), FULL_MONTHS[sName], parseInt(sDay, 10), 0, 0, 0),
        new Date(parseInt(eYear, 10), FULL_MONTHS[eName], parseInt(eDay, 10), 23, 59, 59)
      );
      if (window) return window;
    }
  }

  // "Event duration: Dec 19 – Jan 01" (abbreviated, may cross the year boundary)
  const abbrevRange = text.match(
    new RegExp(String.raw`Event duration:\s*(\w{3})\s+(\d{1,2})\s*${DASH}\s*(\w{3})\s+(\d{1,2})`, 'i')
  );
  if (abbrevRange) {
    const [, sMon, sDay, eMon, eDay] = abbrevRange;
    if (Object.hasOwn(MONTHS, sMon) && Object.hasOwn(MONTHS, eMon)) {
      const startMonth = MONTHS[sMon];
      const endMonth = MONTHS[eMon];
      // Dec to Jan means the end lands in the following year.
      const endYear = startMonth > endMonth ? currentYear + 1 : currentYear;
      const window = bothValid(
        new Date(currentYear, startMonth, parseInt(sDay, 10), 0, 0, 0),
        new Date(endYear, endMonth, parseInt(eDay, 10), 23, 59, 59)
      );
      if (window) return window;
    }
  }

  // "Event duration: Dec 19-25" (same month)
  const abbrevSameMonth = text.match(
    new RegExp(String.raw`Event duration:\s*(\w{3})\s+(\d{1,2})\s*${DASH}\s*(\d{1,2})`, 'i')
  );
  if (abbrevSameMonth) {
    const [, mon, sDay, eDay] = abbrevSameMonth;
    if (Object.hasOwn(MONTHS, mon)) {
      const window = bothValid(
        new Date(currentYear, MONTHS[mon], parseInt(sDay, 10), 0, 0, 0),
        new Date(currentYear, MONTHS[mon], parseInt(eDay, 10), 23, 59, 59)
      );
      if (window) return window;
    }
  }

  // "Event start: 2025-12-04T15:00:00Z" with an optional matching "Event end:"
  const isoStart = text.match(new RegExp(String.raw`Event start:\s*(${ISO_STAMP})`, 'i'));
  if (isoStart) {
    const start = new Date(isoStart[1]);
    if (!isNaN(start.getTime())) {
      const isoEnd = text.match(new RegExp(String.raw`Event end:\s*(${ISO_STAMP})`, 'i'));
      let end: Date;
      if (isoEnd) {
        end = new Date(isoEnd[1]);
      } else {
        // No stated end: run to the end of that day.
        end = new Date(start);
        end.setHours(23, 59, 59, 999);
      }
      const window = bothValid(start, end);
      if (window) return window;
    }
  }

  // "2025-12-04T15:00:00Z – 2025-12-04T23:59:00Z"
  const isoRange = text.match(new RegExp(`(${ISO_STAMP})\\s*${DASH}\\s*(${ISO_STAMP})`));
  if (isoRange) {
    const window = bothValid(new Date(isoRange[1]), new Date(isoRange[2]));
    if (window) return window;
  }

  // "December 4, 2025 at 7:00 AM – December 4, 2025 at 11:59 PM"
  const namedRangeWithTime = text.match(
    new RegExp(
      String.raw`(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*${DASH}\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)`,
      'i'
    )
  );
  if (namedRangeWithTime) {
    const at = (i: number) => namedRangeWithTime[i];
    const start = namedDateTime(at(1), at(2), at(3), at(4), at(5), at(6));
    const end = namedDateTime(at(7), at(8), at(9), at(10), at(11), at(12));
    if (start && end) {
      const window = bothValid(start, end);
      if (window) return window;
    }
  }

  // "Event start: December 4, 2025 at 9:00 AM", optionally with a duration hint
  const namedStart = text.match(
    /Event start:\s*(\w+)\s+(\d{1,2}),?\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (namedStart) {
    const start = namedDateTime(
      namedStart[1], namedStart[2], namedStart[3],
      namedStart[4], namedStart[5], namedStart[6]
    );
    if (start) {
      // Rest of that day, unless the copy states a duration.
      let end = new Date(start);
      end.setHours(23, 59, 59, 0);
      const duration = text.match(/(\d+)\s+(minute|hour)s?/i);
      if (duration) {
        const amount = parseInt(duration[1], 10);
        end = new Date(start);
        if (duration[2].toLowerCase() === 'minute') end.setMinutes(end.getMinutes() + amount);
        else end.setHours(end.getHours() + amount);
      }
      const window = bothValid(start, end);
      if (window) return window;
    }
  }

  // Cross-month range in either spelling and any joiner: "Dec 06 - Dec 07",
  // "December 2 - December 13", "between May 29 and June 3",
  // "from February 27 to March 3", "June 24 - July 12, 2025".
  const crossMonth = new RegExp(
    `${MONTH_WORD}\\s+${DAY}${JOIN}${MONTH_WORD}\\s+${DAY}(?:,?\\s*(\\d{4}))?`,
    'gi'
  );
  for (const m of text.matchAll(crossMonth)) {
    const [, sName, sDay, eName, eDay, year] = m;
    const sm = monthNum(sName);
    const em = monthNum(eName);
    // The month slot matches any word, so skip candidates like "period 2 to
    // June 3" and keep scanning rather than giving up on the first hit.
    if (sm === undefined || em === undefined) continue;
    const y = year ? parseInt(year, 10) : currentYear;
    const window = bothValid(
      new Date(y, sm, parseInt(sDay, 10), 0, 0, 0),
      // Dec to Jan means the end lands in the following year.
      new Date(sm > em ? y + 1 : y, em, parseInt(eDay, 10), 23, 59, 59)
    );
    if (window) return window;
  }

  // Same-month range: "Dec 1-12", "December 3-15", "April 1-4, 2025",
  // "June 28-29". The lookahead stops it eating the first half of a
  // cross-month range the branch above declined.
  const sameMonth = new RegExp(
    `${MONTH_WORD}\\s+${DAY}${JOIN}${DAY}(?!\\s*[A-Za-z]{3,9}\\s+\\d)(?:,?\\s*(\\d{4}))?`,
    'gi'
  );
  for (const m of text.matchAll(sameMonth)) {
    const [, name, sDay, eDay, year] = m;
    const mon = monthNum(name);
    if (mon === undefined) continue;
    const y = year ? parseInt(year, 10) : currentYear;
    const window = bothValid(
      new Date(y, mon, parseInt(sDay, 10), 0, 0, 0),
      new Date(y, mon, parseInt(eDay, 10), 23, 59, 59)
    );
    if (window) return window;
  }

  return null;
}

function namedDateTime(
  monthName: string,
  day: string,
  year: string,
  hours: string,
  minutes: string,
  meridiem: string
): Date | null {
  if (!Object.hasOwn(FULL_MONTHS, monthName)) return null;
  let h = parseInt(hours, 10);
  const upper = meridiem.toUpperCase();
  if (upper === 'PM' && h !== 12) h += 12;
  else if (upper === 'AM' && h === 12) h = 0;
  return new Date(
    parseInt(year, 10),
    FULL_MONTHS[monthName],
    parseInt(day, 10),
    h,
    parseInt(minutes, 10),
    0
  );
}

/**
 * Render a badge's `date_info` for display. Any ISO stamp in it becomes local
 * wall-clock text; prose windows ("Dec 1-12") are already readable and pass
 * through untouched.
 *
 * Sources emit these stamps in UTC, so a raw one is not just machine-looking,
 * it tells the reader the wrong time. A bare stamp with no zone suffix is
 * therefore read as UTC rather than as local. The year is shown only when it is
 * not the current one, which keeps the common case short enough for a toast.
 */
export function formatBadgeDateInfo(dateInfo?: string | null, now: number = Date.now()): string {
  if (!dateInfo) return '';
  const currentYear = new Date(now).getFullYear();
  return decodeHtmlEntities(dateInfo)
    .replace(new RegExp(ISO_STAMP, 'g'), (stamp) => {
      const date = new Date(/[Zz]$/.test(stamp) ? stamp : `${stamp}Z`);
      if (isNaN(date.getTime())) return stamp;
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(date.getFullYear() === currentYear ? {} : { year: 'numeric' }),
        hour: 'numeric',
        minute: '2-digit',
      });
    })
    .trim();
}

function classify(start: number, end: number, now: number): BadgeWindowStatus {
  if (now < start) return 'coming-soon';
  if (now <= end) return 'available';
  return 'expired';
}

/**
 * Classify a badge as upcoming, live, or over. The relay's `starts_utc` /
 * `ends_utc` come straight from the Drops campaign so they win outright, then
 * ISO stamps in the copy (they carry a real year), then prose.
 *
 * Null when there is no window, which is correct for permanent badges
 * (subscriber tenure, founder, Prime).
 */
export function deriveBadgeStatus(
  moreInfo?: string | null,
  enrichment?: Record<string, unknown> | null,
  now: number = Date.now()
): BadgeWindowStatus | null {
  // Campaign window: authoritative, no parsing required.
  const iso = (key: string): number | null => {
    const raw = enrichment?.[key];
    if (typeof raw !== 'string') return null;
    const ms = new Date(raw).getTime();
    return isNaN(ms) ? null : ms;
  };
  const startIso = iso('starts_utc');
  const endIso = iso('ends_utc');
  if (startIso !== null || endIso !== null) {
    return classify(startIso ?? -Infinity, endIso ?? Infinity, now);
  }

  if (!moreInfo) return null;

  // ISO stamps in the copy. One stamp plus a duration hint is a window; one
  // stamp alone runs to the end of that day.
  const stamps = moreInfo.match(new RegExp(`(${ISO_STAMP})`, 'g'));
  if (stamps && stamps.length > 0) {
    if (stamps.length === 1) {
      const start = new Date(stamps[0]);
      if (!isNaN(start.getTime())) {
        const duration = moreInfo.match(/(\d+)\s+(minute|hour)s?/i);
        const end = new Date(start);
        if (duration) {
          const amount = parseInt(duration[1], 10);
          if (duration[2].toLowerCase() === 'minute') end.setMinutes(end.getMinutes() + amount);
          else end.setHours(end.getHours() + amount);
        } else {
          end.setHours(23, 59, 59, 0);
        }
        return classify(start.getTime(), end.getTime(), now);
      }
    } else {
      const ms = stamps.map((s) => new Date(s).getTime()).filter((t) => !isNaN(t));
      if (ms.length >= 2) {
        // A campaign can run in separate bursts ("First Release ... Second
        // Release ..."). Treating the stamps as one span would report the badge
        // earnable during the gap, so pair them into runs and answer against
        // whichever run the clock is in. Odd counts fall back to the outer span.
        const runs: Array<[number, number]> = [];
        if (ms.length % 2 === 0) {
          for (let i = 0; i < ms.length; i += 2) {
            runs.push([Math.min(ms[i], ms[i + 1]), Math.max(ms[i], ms[i + 1])]);
          }
        } else {
          runs.push([Math.min(...ms), Math.max(...ms)]);
        }
        if (runs.some(([s, e]) => now >= s && now <= e)) return 'available';
        if (runs.some(([s]) => now < s)) return 'coming-soon';
        return 'expired';
      }
    }
  }

  // Prose formats. Year-less ones assume the current year.
  const range = parseDateRange(moreInfo);
  if (range) return classify(range.start.getTime(), range.end.getTime(), now);

  return null;
}
