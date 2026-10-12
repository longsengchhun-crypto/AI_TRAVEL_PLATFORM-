export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = () => isoDate(new Date());
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
export function nightsBetween(ci: string, co: string): number {
  return Math.round((Date.parse(co + "T00:00:00Z") - Date.parse(ci + "T00:00:00Z")) / 86_400_000);
}
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
export function hhmmToMin(s: string): number | null {
  if (!s) return null;
  const [hh, mm] = s.split(":").map(Number);
  return hh * 60 + (mm || 0);
}
