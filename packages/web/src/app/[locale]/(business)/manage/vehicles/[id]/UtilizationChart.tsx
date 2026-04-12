'use client'

interface DailyUtilization {
  date: string
  bookedHours: number
}

interface UtilizationChartProps {
  data: DailyUtilization[]
}

const MAX_HOURS_PER_DAY = 24
const BAR_WIDTH = 16
const BAR_GAP = 4
const CHART_HEIGHT = 120
const LABEL_HEIGHT = 20

export function UtilizationChart({ data }: UtilizationChartProps) {
  const maxHours = Math.max(...data.map((d) => d.bookedHours), 1)
  const chartWidth = data.length * (BAR_WIDTH + BAR_GAP) - BAR_GAP
  const totalHeight = CHART_HEIGHT + LABEL_HEIGHT

  return (
    <div className="overflow-x-auto">
      <svg
        width={chartWidth}
        height={totalHeight}
        viewBox={`0 0 ${chartWidth} ${totalHeight}`}
        className="min-w-full"
        role="img"
        aria-label="Vehicle utilization chart showing booked hours per day over the last 30 days"
      >
        {data.map((day, i) => {
          const barHeight = (day.bookedHours / MAX_HOURS_PER_DAY) * CHART_HEIGHT
          const x = i * (BAR_WIDTH + BAR_GAP)
          const y = CHART_HEIGHT - barHeight
          const intensity = day.bookedHours / maxHours

          // Show date label every 7th day
          const showLabel = i % 7 === 0

          return (
            <g key={day.date}>
              {/* Background bar */}
              <rect
                x={x}
                y={0}
                width={BAR_WIDTH}
                height={CHART_HEIGHT}
                rx={3}
                className="fill-muted"
              />
              {/* Booked hours bar */}
              {barHeight > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={BAR_WIDTH}
                  height={barHeight}
                  rx={3}
                  className="fill-primary"
                  style={{ opacity: 0.4 + intensity * 0.6 }}
                >
                  <title>
                    {day.date}: {day.bookedHours.toFixed(1)}h
                  </title>
                </rect>
              )}
              {/* Date label */}
              {showLabel && (
                <text
                  x={x + BAR_WIDTH / 2}
                  y={CHART_HEIGHT + LABEL_HEIGHT - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px]"
                >
                  {day.date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
