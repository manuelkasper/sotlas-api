// SOTA Alerts → ICS Calendar
// Returns iCal calendar for downloading SOTAwatch alerts

import { Request, Response } from 'express';
import * as crypto from 'crypto';
import 'express-cache-controller';
const alerts = require('./alerts');

interface SotaAlert {
  id: number;
  userID: number;
  timeStamp: Date;
  dateActivated: Date;
  summit: {
    code: string;
    name?: string;
    [key: string]: any;
  };
  activatorCallsign: string;
  posterCallsign?: string;
  frequency?: string;
  comments?: string;
}

// Build ICS file
async function buildICS(alerts: SotaAlert[]): Promise<string> {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("PRODID:-//SOTA Alerts//EN");
  lines.push("VERSION:2.0");
  lines.push("CALSCALE:GREGORIAN");
  lines.push("METHOD:PUBLISH");

  for (const alert of alerts) {
    try {
      lines.push("BEGIN:VEVENT");
      const now = new Date();
      const summitTime = alert.dateActivated || alert.timeStamp;
      const timeStamp = alert.timeStamp;

      const title =
        `${alert.activatorCallsign} on ${alert.summit.code}`;

      const { begin, end } = computeWindow(summitTime, alert.comments);
      const uid = await computeUID(title, summitTime);

      const summitUrl = `https://sotl.as/summits/${alert.summit.code}`;

      // Build location string with name, altitude, and points
      const locationParts: string[] = [];
      if (alert.summit.name) {
        locationParts.push(alert.summit.name);
      }
      if (alert.summit.altitude !== undefined) {
        locationParts.push(`${alert.summit.altitude}m`);
      }
      if (alert.summit.points !== undefined) {
        locationParts.push(`${alert.summit.points}pt`);
      }
      const location = locationParts.length > 0 ? locationParts.join(', ') : '';

      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${formatICSDate(now)}`);
      lines.push(`SUMMARY:${escapeICS(title)}`);
      lines.push(`DTSTART:${formatICSDate(begin)}`);
      lines.push(`DTEND:${formatICSDate(end)}`);
      lines.push(`URL:${summitUrl}`);
      if (location) {
        lines.push(`LOCATION:${escapeICS(location)}`);
      }

      const ago = relativeTime(now.getTime() - timeStamp.getTime());

      const descParts: string[] = [];
      descParts.push(`Freqs: ${alert.frequency || "Unknown"}`);
      if (alert.comments) {
        descParts.push(`Comments: ${alert.comments}`);
      }
      descParts.push(
        `Last updated ${ago} by ${alert.posterCallsign || "Unknown"}`
      );

      lines.push(`DESCRIPTION:${escapeICS(descParts.join("\r\n"))}`);
      lines.push("END:VEVENT");
    } catch (err) {
      // Skip malformed alert
      console.warn("Skipping alert due to error:", err);
    }
  }

  lines.push("END:VCALENDAR");
  return foldICS(lines).join("\r\n") + "\r\n";
}

// Compute begin/end using S+N / S-N logic
function computeWindow(summitTime: Date, comments?: string): { begin: Date; end: Date } {
  let hoursAfter = 3;
  let hoursBefore = 1;

  if (comments) {
    const plusMatch = comments.match(/[Ss]\+(\d+)/);
    if (plusMatch) hoursAfter = parseInt(plusMatch[1], 10);
    const minusMatch = comments.match(/[Ss]-(\d+)/);
    if (minusMatch) hoursBefore = parseInt(minusMatch[1], 10);
  }
  const begin = new Date(summitTime.getTime() - hoursBefore * 3600_000);
  const end = new Date(summitTime.getTime() + hoursAfter * 3600_000);
  return { begin, end };
}

// Relative time (simple humanize)
function relativeTime(msDiff: number): string {
  const sec = Math.round(msDiff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const week = Math.round(day / 7);
  if (week < 4) return `${week}w ago`;
  const month = Math.round(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.round(day / 365);
  return `${year}y ago`;
}

// ICS date format YYYYMMDDTHHMMSSZ
function formatICSDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// Escape commas, semicolons, backslashes per RFC5545
function escapeICS(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r?\n/g, "\\n");
}

// Truncated SHA256 hex via Node.js Crypto
async function computeUID(title: string, summitTime: Date): Promise<string> {
  const data = title + summitTime.getUTCMonth().toString();
  const hash = crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
  return `${hash}@sota.org.uk`;
}

// Fold lines at 75 octets with continuation
function foldICS(lines: string[]): string[] {
  const folded: string[] = [];
  for (const line of lines) {
    let current = line;
    while (utf8Length(current) > 75) {
      let sliceLen = 75;
      // Adjust to not cut inside escape sequences (simple approach)
      let part = current.slice(0, sliceLen);
      folded.push(part);
      current = " " + current.slice(sliceLen);
    }
    folded.push(current);
  }
  return folded;
}

function utf8Length(str: string): number {
  return new TextEncoder().encode(str).length;
}

// Express route handler
export async function handleSotaCal(req: Request, res: Response): Promise<void> {
  const format = req.query.format as string | undefined;
  const filter = req.query.filter as string | undefined;
  const modes = req.query.modes as string | undefined;
  const continents = req.query.continents as string | undefined;

  try {
    // Get alerts from the cached alerts.js module
    const alertList = await alerts.loadAlerts(false);

    let filteredAlerts = alertList as SotaAlert[];

    // Filter by text search (summit code, summit name, or activator callsign only)
    if (filter) {
      try {
        // Security: Limit regex pattern length to prevent ReDoS attacks
        // Typical patterns should be < 100 chars; 200 is a reasonable upper limit
        if (filter.length > 200) {
          // Pattern too long, treat as invalid
          filteredAlerts = [];
        } else {
          const regex = new RegExp(filter, "i");
          filteredAlerts = filteredAlerts.filter(alert =>
            (alert.summit.code && regex.test(alert.summit.code)) ||
            (alert.summit.name && regex.test(alert.summit.name)) ||
            (alert.activatorCallsign && regex.test(alert.activatorCallsign))
          );
        }
      } catch (e) {
        // Invalid regex, return empty results
        filteredAlerts = [];
      }
    }

    // Filter by modes (check if frequency contains any of the specified modes)
    if (modes) {
      const modeList = modes.split(',').map(m => m.trim().toLowerCase());
      filteredAlerts = filteredAlerts.filter(alert => {
        if (!alert.frequency) return false;
        const frequencyLower = alert.frequency.toLowerCase();
        return modeList.some(mode => frequencyLower.includes(mode));
      });
    }

    // Filter by continents
    if (continents) {
      const continentList = continents.split(',').map(c => c.trim().toUpperCase());
      filteredAlerts = filteredAlerts.filter(alert => {
        if (!alert.summit || !alert.summit.continent) return false;
        return continentList.includes(alert.summit.continent);
      });
    }

    if (format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json(filteredAlerts);
      return Promise.resolve();
    }

    const ics = await buildICS(filteredAlerts);
    res.cacheControl = {
      maxAge: 300
    };
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="sota_alerts.ics"');
    res.send(ics);
  } catch (err) {
    console.error("Error generating SOTA calendar:", err);
    res.status(500).end();
  }
}

