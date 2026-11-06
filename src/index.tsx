import {
  type CalendarEvent,
  ChevronLeftIcon,
  ChevronRightIcon,
  Temporal,
  cn,
  dayProps,
  epochDay,
  formatLongDate,
  formatMonth,
  formatShortDate,
  formatTime,
  isAllDay,
  layoutAllDay,
  selectionProps,
  useDayGrid,
  useDisplaySettings,
  useEventProps,
  useEventsInRange,
  useNavigation,
  useToday,
} from "@rencomputer/rencal-sdk"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import "./life-spiral.css"

// ---------- geometry ----------

const TAU = Math.PI * 2
const P = 100 // distance between rings
const W = 74 // sausage thickness
const MAX_STACK = 5 // event capsules stacked across the tube
const LANE = 7 // multi-day lane thickness
const MAX_LANES = 3

const YEAR_OPTIONS = [1, 3, 5, 10] as const
const DOSES = [
  { name: "sober", icon: "🫖", tag: "a calendar. that's it." },
  { name: "micro", icon: "🍄", tag: "time is a sausage, gently." },
  { name: "trip", icon: "🌀", tag: "every day is the same day, curled." },
  { name: "heroic", icon: "👁️", tag: "you ARE the sausage." },
] as const

interface Day {
  idx: number
  date: Temporal.PlainDate
  epoch: number
  t0: number
  t1: number
  k: number
  frac: number
  weekend: boolean
  monthStart: boolean
}

interface Geo {
  startYear: number
  years: number
  R0: number
  H: number
  start: Temporal.PlainDate
  end: Temporal.PlainDate
  startEpoch: number
  days: Day[]
}

function buildGeo(startYear: number, years: number): Geo {
  const R0 = Math.max(230, years * P * 0.3 + 160)
  const start = Temporal.PlainDate.from({ year: startYear, month: 1, day: 1 })
  const end = Temporal.PlainDate.from({ year: startYear + years, month: 1, day: 1 })
  const startEpoch = epochDay(start)
  const days: Day[] = []
  for (let y = 0; y < years; y++) {
    let d = Temporal.PlainDate.from({ year: startYear + y, month: 1, day: 1 })
    const n = d.daysInYear
    for (let i = 0; i < n; i++) {
      days.push({
        idx: days.length,
        date: d,
        epoch: startEpoch + days.length,
        t0: (y + i / n) * TAU,
        t1: (y + (i + 1) / n) * TAU,
        k: y,
        frac: i / n,
        weekend: d.dayOfWeek >= 6,
        monthStart: d.day === 1,
      })
      d = d.add({ days: 1 })
    }
  }
  return { startYear, years, R0, H: R0 + years * P + W / 2 + 60, start, end, startEpoch, days }
}

const rc = (g: Geo, t: number) => g.R0 + (P * t) / TAU
const pt = (t: number, r: number): [number, number] => [r * Math.sin(t), -r * Math.cos(t)]
const f = (n: number) => n.toFixed(1)
const xy = ([x, y]: [number, number]) => `${f(x)} ${f(y)}`

/** A slice of the tube between angles t0..t1 and radial offsets a..b from its centre line. */
function band(g: Geo, t0: number, t1: number, a: number, b: number, steps?: number) {
  const n = steps ?? Math.max(2, Math.ceil((t1 - t0) / 0.02))
  const outer: string[] = []
  const inner: string[] = []
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n
    const r = rc(g, t)
    outer.push(xy(pt(t, r + b)))
    inner.push(xy(pt(t, r + a)))
  }
  return `M${outer.join("L")}L${inner.reverse().join("L")}Z`
}

function strand(g: Geo, t0: number, t1: number, off: number, step = 0.02) {
  const n = Math.max(1, Math.ceil((t1 - t0) / step))
  const p: string[] = []
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n
    p.push(xy(pt(t, rc(g, t) + off)))
  }
  return `M${p.join("L")}`
}

function segFill(d: Day, todayEpoch: number) {
  const hue = Math.round((d.frac * 360 + d.k * 53) % 360)
  const past = d.epoch < todayEpoch
  const light = d.weekend ? 50 : 64
  const mix = past ? 64 : 24
  return `color-mix(in oklab, hsl(${hue} 92% ${light}%) ${mix}%, var(--background))`
}

// ---------- view ----------

export default function LifeSpiralView() {
  const today = useToday()
  const { activeDate, goToDate } = useNavigation()
  const { timeFormat } = useDisplaySettings()
  const { selection } = useDayGrid()

  const [years, setYears] = useState<number>(5)
  const [dose, setDose] = useState(1)
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const [hoverEvent, setHoverEvent] = useState<CalendarEvent | null>(null)

  const startYear = activeDate.year - Math.floor((years - 1) / 2)
  const geo = useMemo(() => buildGeo(startYear, years), [startYear, years])
  const todayEpoch = epochDay(today)
  const todayIdx = todayEpoch - geo.startEpoch
  const activeIdx = epochDay(activeDate) - geo.startEpoch
  const inRange = (i: number) => i >= 0 && i < geo.days.length

  const events = useEventsInRange(geo.start, geo.end)

  // split into one-day capsules and multi-day strands
  const { byDay, bars, laneCount, total } = useMemo(() => {
    const byDay = new Map<number, CalendarEvent[]>()
    const multi: CalendarEvent[] = []
    let total = 0
    for (const e of events) {
      if (!e.transient) total++
      if (Temporal.PlainDate.compare(e.firstDay, e.lastDay) !== 0) {
        multi.push(e)
        continue
      }
      const i = epochDay(e.firstDay) - geo.startEpoch
      if (i < 0 || i >= geo.days.length) continue
      const list = byDay.get(i)
      if (list) list.push(e)
      else byDay.set(i, [e])
    }
    const { bars, laneCount } = layoutAllDay(multi, geo.start, geo.days.length)
    return { byDay, bars: bars.filter((b) => b.lane < MAX_LANES), laneCount, total }
  }, [events, geo])

  const laneReserve = Math.min(laneCount, MAX_LANES) * LANE
  const slot = (W - 10 - laneReserve) / MAX_STACK

  // measure the stage so the centre panel can fit the hole
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(600)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(Math.max(200, Math.min(width, height) - 24))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const holePx = ((2 * (geo.R0 - W / 2 - 16)) / (2 * geo.H)) * size

  const viewBox = `${-geo.H} ${-geo.H} ${geo.H * 2} ${geo.H * 2}`

  const tube = useMemo(
    () => <Tube geo={geo} todayEpoch={todayEpoch} interactive />,
    [geo, todayEpoch],
  )
  const ghost = useMemo(
    () => (dose >= 2 ? <Tube geo={geo} todayEpoch={todayEpoch} interactive={false} /> : null),
    [geo, todayEpoch, dose >= 2],
  )

  const centreline = useMemo(() => strand(geo, 0, geo.years * TAU, 0, 0.05), [geo])

  // the worm's head sits just past the last day, eyes on whatever you hover
  const tEnd = geo.years * TAU
  const rEnd = rc(geo, tEnd)
  const headR = W * 0.62
  const head = pt(tEnd + (headR * 0.55) / rEnd, rEnd)
  const lookIdx = hoverDay ?? (inRange(todayIdx) ? todayIdx : null)
  const lookAt =
    lookIdx != null
      ? (() => {
          const d = geo.days[lookIdx]
          const t = (d.t0 + d.t1) / 2
          return pt(t, rc(geo, t))
        })()
      : ([0, 0] as [number, number])

  const onMove = (e: React.PointerEvent) => {
    const i = (e.target as Element).getAttribute?.("data-i")
    setHoverDay(i == null ? null : Number(i))
  }
  const onClick = (e: React.MouseEvent) => {
    const i = (e.target as Element).getAttribute?.("data-i")
    if (i != null) goToDate(geo.days[Number(i)].date)
  }

  const selPath = useMemo(() => {
    if (!selection || selection.kind !== "days") return null
    const a = Math.max(0, epochDay(selection.firstDay) - geo.startEpoch)
    const b = Math.min(geo.days.length - 1, epochDay(selection.lastDay) - geo.startEpoch)
    if (a > b) return null
    return band(geo, geo.days[a].t0, geo.days[b].t1, -W / 2 - 3, W / 2 + 3)
  }, [selection, geo])

  return (
    <div className="ls-root flex h-full flex-col overflow-hidden bg-background text-foreground" data-dose={dose}>
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-sm">
        <div className="flex items-center gap-1">
          <IconBtn label="Previous year" onClick={() => goToDate(activeDate.add({ years: -1 }))}>
            <ChevronLeftIcon className="size-4" />
          </IconBtn>
          <IconBtn label="Next year" onClick={() => goToDate(activeDate.add({ years: 1 }))}>
            <ChevronRightIcon className="size-4" />
          </IconBtn>
          <span className="ml-1 font-medium tabular-nums">
            {geo.startYear}
            {years > 1 && ` – ${geo.startYear + years - 1}`}
          </span>
        </div>

        <Segmented
          value={years}
          onChange={setYears}
          options={YEAR_OPTIONS.map((y) => ({ value: y, label: `${y}y` }))}
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">dose</span>
          <Segmented
            value={dose}
            onChange={setDose}
            options={DOSES.map((d, i) => ({ value: i, label: d.icon, title: d.name }))}
          />
        </div>
      </div>

      {/* stage */}
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div className="ls-stage relative" style={{ width: size, height: size }}>
          <div className="ls-aura absolute inset-[-8%]" />
          <div className="ls-spin absolute inset-0">
            {/* kaleidoscope ghost */}
            <svg viewBox={viewBox} className="ls-ghost absolute inset-0 size-full">
              {dose === 3 && (
                <filter id="ls-wobble">
                  <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="2" seed="4">
                    <animate attributeName="baseFrequency" dur="9s" values="0.004;0.014;0.004" repeatCount="indefinite" />
                  </feTurbulence>
                  <feDisplacementMap in="SourceGraphic" scale="60" />
                </filter>
              )}
              <g filter={dose === 3 ? "url(#ls-wobble)" : undefined}>{ghost}</g>
            </svg>

            {/* the sausage itself: day segments are drop/create targets */}
            <svg
              viewBox={viewBox}
              className="ls-tube absolute inset-0 size-full"
              onPointerMove={onMove}
              onPointerLeave={() => setHoverDay(null)}
              onClick={onClick}
            >
              {tube}
            </svg>

            {/* events, markers and the worm on top */}
            <svg viewBox={viewBox} className="pointer-events-none absolute inset-0 size-full">
              {/* comets crawling from the past */}
              <g className="ls-comet">
                {[0, 1, 2].map((n) => (
                  <circle key={n} r={7} fill="var(--foreground)" opacity={0.7}>
                    <animateMotion dur={`${14 + n * 5}s`} begin={`${-n * 4}s`} repeatCount="indefinite" path={centreline} />
                  </circle>
                ))}
              </g>

              {selPath && <path {...selectionProps()} d={selPath} className="fill-primary/40 stroke-primary" strokeWidth={2} />}

              <g>
                {bars.map((b) => {
                  const a = geo.days[b.column]
                  const z = geo.days[b.column + b.span - 1]
                  return (
                    <EventStrand
                      key={b.item.key}
                      event={b.item}
                      d={strand(geo, a.t0 + 0.004, z.t1 - 0.004, W / 2 - 6 - b.lane * LANE)}
                      onHover={setHoverEvent}
                    />
                  )
                })}
              </g>

              <g>
                {[...byDay].flatMap(([i, list]) => {
                  const d = geo.days[i]
                  const t = (d.t0 + d.t1) / 2
                  const r = rc(geo, t)
                  const arc = (r * TAU) / d.date.daysInYear
                  const sw = Math.min(arc * 0.62, slot * 0.8, 9)
                  return list.slice(0, MAX_STACK).map((e, s) => {
                    const r0 = r - W / 2 + 5 + s * slot + sw / 2 + 1
                    const r1 = r - W / 2 + 5 + (s + 1) * slot - sw / 2 - 1
                    const [x1, y1] = pt(t, r0)
                    const [x2, y2] = pt(t, Math.max(r0, r1))
                    return <EventCapsule key={e.key} event={e} x1={x1} y1={y1} x2={x2} y2={y2} sw={sw} onHover={setHoverEvent} />
                  })
                })}
              </g>

              {/* year labels at the January seam */}
              {Array.from({ length: years }, (_, k) => {
                const t = k * TAU + 0.025
                const [x, y] = pt(t, rc(geo, t))
                return (
                  <text
                    key={k}
                    x={x}
                    y={y}
                    transform={`rotate(${f((t * 180) / Math.PI)} ${f(x)} ${f(y)})`}
                    className="fill-foreground stroke-background"
                    strokeWidth={5}
                    paintOrder="stroke"
                    fontSize={20}
                    fontWeight={700}
                    dominantBaseline="central"
                  >
                    {geo.startYear + k}
                  </text>
                )
              })}

              {/* month names around the outside */}
              {geo.days
                .filter((d) => d.k === years - 1 && d.date.day === 15)
                .map((d) => {
                  const t = (d.t0 + d.t1) / 2
                  const [x, y] = pt(t, rc(geo, t) + W / 2 + 26)
                  let deg = ((t * 180) / Math.PI) % 360
                  if (deg > 90 && deg < 270) deg += 180
                  return (
                    <text
                      key={d.idx}
                      x={x}
                      y={y}
                      transform={`rotate(${f(deg)} ${f(x)} ${f(y)})`}
                      className="fill-muted-foreground"
                      fontSize={18}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {formatMonth(d.date, "short")}
                    </text>
                  )
                })}

              {hoverDay != null && inRange(hoverDay) && (
                <path
                  d={band(geo, geo.days[hoverDay].t0, geo.days[hoverDay].t1, -W / 2 - 2, W / 2 + 2, 2)}
                  fill="none"
                  className="stroke-foreground"
                  strokeWidth={2.5}
                />
              )}

              {inRange(activeIdx) && activeIdx !== todayIdx && (
                <path
                  d={band(geo, geo.days[activeIdx].t0, geo.days[activeIdx].t1, -W / 2 - 5, W / 2 + 5, 2)}
                  fill="none"
                  className="stroke-primary"
                  strokeWidth={3}
                />
              )}

              {inRange(todayIdx) && <TodayMarker geo={geo} day={geo.days[todayIdx]} />}

              <Worm head={head} headR={headR} lookAt={lookAt} />
            </svg>
          </div>

          {/* readout in the hole */}
          <div
            className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center overflow-hidden rounded-full text-center"
            style={{ width: holePx, height: holePx }}
          >
            <Readout
              geo={geo}
              hoverDay={hoverDay}
              hoverEvent={hoverEvent}
              today={today}
              todayIdx={todayIdx}
              total={total}
              dose={dose}
              timeFormat={timeFormat}
              compact={holePx < 170}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- pieces ----------

const Tube = memo(function Tube({ geo, todayEpoch, interactive }: { geo: Geo; todayEpoch: number; interactive: boolean }) {
  const first = geo.days[0]
  const tail = pt(0, geo.R0)
  return (
    <>
      <circle cx={tail[0]} cy={tail[1]} r={W / 2} style={{ fill: segFill(first, todayEpoch) }} />
      {geo.days.map((d) => (
        <path
          key={d.idx}
          {...(interactive ? { ...dayProps(d.date, "day"), "data-i": d.idx } : {})}
          d={band(geo, d.t0, d.t1 + 0.0004, -W / 2, W / 2, 2)}
          style={{ fill: segFill(d, todayEpoch) }}
        />
      ))}
      {/* month seams */}
      {geo.days
        .filter((d) => d.monthStart)
        .map((d) => {
          const r = rc(geo, d.t0)
          return (
            <line
              key={`m${d.idx}`}
              x1={pt(d.t0, r - W / 2)[0]}
              y1={pt(d.t0, r - W / 2)[1]}
              x2={pt(d.t0, r + W / 2)[0]}
              y2={pt(d.t0, r + W / 2)[1]}
              stroke="var(--background)"
              strokeWidth={d.date.month === 1 ? 4 : 1.6}
              pointerEvents="none"
            />
          )
        })}
      {/* sausage sheen */}
      <path
        d={strand(geo, 0, geo.years * TAU, -W * 0.22, 0.03)}
        fill="none"
        stroke="white"
        strokeOpacity={0.13}
        strokeWidth={W * 0.16}
        strokeLinecap="round"
        pointerEvents="none"
      />
    </>
  )
})

function EventCapsule({
  event,
  x1,
  y1,
  x2,
  y2,
  sw,
  onHover,
}: {
  event: CalendarEvent
  x1: number
  y1: number
  x2: number
  y2: number
  sw: number
  onHover: (e: CalendarEvent | null) => void
}) {
  const props = useEventProps(event, { drag: "pill" })
  return (
    <line
      {...props}
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      strokeWidth={sw}
      strokeLinecap="round"
      className="ls-mark pointer-events-auto stroke-(--calendar-event-fill) data-selected:stroke-(--calendar-event-selected-fill) data-draft:opacity-70"
      onPointerEnter={() => onHover(event)}
      onPointerLeave={() => onHover(null)}
    />
  )
}

function EventStrand({ event, d, onHover }: { event: CalendarEvent; d: string; onHover: (e: CalendarEvent | null) => void }) {
  const props = useEventProps(event, { drag: "pill" })
  return (
    <path
      {...props}
      d={d}
      fill="none"
      strokeWidth={4.5}
      strokeLinecap="round"
      className="pointer-events-auto cursor-pointer stroke-(--calendar-event-fill) data-selected:stroke-(--calendar-event-selected-fill)"
      onPointerEnter={() => onHover(event)}
      onPointerLeave={() => onHover(null)}
    />
  )
}

function TodayMarker({ geo, day }: { geo: Geo; day: Day }) {
  const t = (day.t0 + day.t1) / 2
  const [x, y] = pt(t, rc(geo, t))
  return (
    <g>
      <circle className="ls-pulse stroke-foreground" cx={x} cy={y} r={8} fill="none" strokeWidth={3} />
      <circle cx={x} cy={y} r={7} className="fill-foreground stroke-background" strokeWidth={3} />
    </g>
  )
}

function Worm({ head, headR, lookAt }: { head: [number, number]; headR: number; lookAt: [number, number] }) {
  const [hx, hy] = head
  // the spiral ends at 12 o'clock heading right: face forward, eyes stacked
  const eyes: [number, number][] = [
    [hx + headR * 0.28, hy - headR * 0.36],
    [hx + headR * 0.28, hy + headR * 0.2],
  ]
  const er = headR * 0.27
  return (
    <g>
      <circle cx={hx} cy={hy} r={headR} fill="hsl(310 85% 62%)" className="stroke-background" strokeWidth={4} />
      <ellipse cx={hx - headR * 0.25} cy={hy - headR * 0.45} rx={headR * 0.35} ry={headR * 0.18} fill="white" opacity={0.3} />
      {eyes.map(([ex, ey], i) => {
        const dx = lookAt[0] - ex
        const dy = lookAt[1] - ey
        const len = Math.hypot(dx, dy) || 1
        return (
          <g key={i}>
            <circle cx={ex} cy={ey} r={er} fill="white" />
            <circle cx={ex + (dx / len) * er * 0.45} cy={ey + (dy / len) * er * 0.45} r={er * 0.5} fill="#111" />
          </g>
        )
      })}
      <path
        d={`M${f(hx + headR * 0.62)} ${f(hy - headR * 0.08)} q ${f(headR * 0.22)} ${f(headR * 0.12)} 0 ${f(headR * 0.3)}`}
        fill="none"
        stroke="#111"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </g>
  )
}

function Readout({
  geo,
  hoverDay,
  hoverEvent,
  today,
  todayIdx,
  total,
  dose,
  timeFormat,
  compact,
}: {
  geo: Geo
  hoverDay: number | null
  hoverEvent: CalendarEvent | null
  today: Temporal.PlainDate
  todayIdx: number
  total: number
  dose: number
  timeFormat: "24h" | "12h"
  compact: boolean
}) {
  const big = compact ? "text-sm" : "text-lg"
  const small = compact ? "text-2xs" : "text-xs"

  if (hoverEvent) {
    return (
      <div className="flex max-w-[80%] flex-col items-center gap-1">
        <div className={cn(big, "line-clamp-3 font-semibold")}>{hoverEvent.summary || "Untitled"}</div>
        <div className={cn(small, "text-muted-foreground")}>
          {formatShortDate(hoverEvent.start)}
          {!isAllDay(hoverEvent.start) && ` · ${formatTime(hoverEvent.start, timeFormat)}`}
          {Temporal.PlainDate.compare(hoverEvent.firstDay, hoverEvent.lastDay) !== 0 &&
            ` → ${formatShortDate(hoverEvent.lastDay)}`}
        </div>
      </div>
    )
  }

  if (hoverDay != null && hoverDay >= 0 && hoverDay < geo.days.length) {
    const d = geo.days[hoverDay]
    const delta = d.epoch - epochDay(today)
    const rel =
      delta === 0 ? "today" : delta > 0 ? `in ${delta.toLocaleString()} days` : `${(-delta).toLocaleString()} days ago`
    return (
      <div className="flex max-w-[80%] flex-col items-center gap-1">
        <div className={cn(big, "font-semibold")}>{formatLongDate(d.date)}</div>
        <div className={cn(small, "text-muted-foreground")}>{rel}</div>
      </div>
    )
  }

  const lived = Math.max(0, Math.min(geo.days.length, todayIdx))
  const pct = Math.round((lived / geo.days.length) * 100)
  return (
    <div className="flex max-w-[80%] flex-col items-center gap-1">
      <div className={cn(small, "tracking-widest text-muted-foreground uppercase")}>you are here</div>
      <div className={cn(big, "font-semibold")}>{formatLongDate(today)}</div>
      {!compact && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {pct}% of this coil eaten · {total.toLocaleString()} events
        </div>
      )}
      <div className={cn(small, "text-muted-foreground italic")}>{DOSES[dose].tag}</div>
    </div>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
    >
      {children}
    </button>
  )
}

function Segmented<T extends number>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; title?: string }[]
}) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2 py-0.5 text-xs tabular-nums",
            o.value === value ? "bg-selected text-selected-foreground" : "text-muted-foreground hover:bg-hover",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
