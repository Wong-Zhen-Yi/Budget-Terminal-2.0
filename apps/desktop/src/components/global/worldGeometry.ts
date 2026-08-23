import worldUrl from '@/assets/world_countries_50m.json?url'

/**
 * Natural Earth 1:50m country outlines, and the plate-carrée projection the Global map
 * draws them with.
 *
 * The file is 1.5 MB, so it is fetched as an asset URL rather than imported into the
 * renderer bundle, and held behind one module-level promise — the same single-load
 * contract as the reference's class-level `_WORLD_FEATURES` cache.
 */

/** `[longitude, latitude]`, as the asset stores them. */
export type Coordinate = [number, number]
export type Ring = Coordinate[]
/** A polygon is an outer ring plus any holes; a country is a list of polygons. */
export type Polygon = Ring[]

export interface WorldFeature {
  name: string
  polygons: Polygon[]
}

export interface MapRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

let pending: Promise<WorldFeature[]> | null = null

export function loadWorldFeatures(): Promise<WorldFeature[]> {
  pending ??= fetch(worldUrl)
    .then((response) => response.json())
    .then((payload: unknown) => {
      const features = (payload as { features?: unknown }).features
      if (!Array.isArray(features)) return []
      return features.filter(
        (feature): feature is WorldFeature =>
          typeof feature === 'object' && feature !== null && Array.isArray((feature as WorldFeature).polygons),
      )
    })
    .catch(() => [])
  return pending
}

/** `_map_rect`: the drawable area, inset from the widget by a fixed margin. */
export const MAP_MARGIN = 12

export function mapRect(width: number, height: number): MapRect {
  return {
    x: MAP_MARGIN,
    y: MAP_MARGIN,
    width: Math.max(1, width - MAP_MARGIN * 2),
    height: Math.max(1, height - MAP_MARGIN * 2),
  }
}

/** `_project`: plate carrée, clamped to the poles and the date line. */
export function project(lat: number, lon: number, rect: MapRect): Point {
  const latValue = Number.isFinite(lat) ? Math.max(Math.min(lat, 90), -90) : 0
  const lonValue = Number.isFinite(lon) ? Math.max(Math.min(lon, 180), -180) : 0
  return {
    x: rect.x + ((lonValue + 180) / 360) * rect.width,
    y: rect.y + ((90 - latValue) / 180) * rect.height,
  }
}
