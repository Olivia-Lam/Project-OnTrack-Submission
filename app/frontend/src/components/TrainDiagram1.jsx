// Stylized to read as an actual NEL (Purple Line) train: white/silver body,
// purple livery stripe, tinted window band, and a small LED indicator
// mounted above each door — mirroring the physical hardware concept rather
// than an abstract colored-box diagram.

const CAR_COUNT = 3;

export default function TrainDiagram({ doors }) {
  const bodyX = 30;
  const bodyWidth = 440;
  const bodyY = 34;
  const bodyHeight = 68;
  const doorGap = 4;
  const doorWidth = (bodyWidth - doorGap * (doors.length - 1)) / doors.length;

  return (
    <div className="train-diagram">
      <svg
        className="train-svg"
        viewBox="0 0 500 150"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Train car with a live crowd-density light above each door"
      >
        {/* body */}
        <rect
          x={bodyX - 8}
          y={bodyY}
          width={bodyWidth + 16}
          height={bodyHeight}
          rx="16"
          className="train-body"
        />
        {/* nose cone, leading car */}
        <path
          d={`M ${bodyX - 8} ${bodyY} Q ${bodyX - 26} ${bodyY + bodyHeight / 2} ${bodyX - 8} ${bodyY + bodyHeight} Z`}
          className="train-body"
        />

        {/* tinted window band */}
        <rect x={bodyX} y={bodyY + 6} width={bodyWidth} height="18" rx="6" className="train-window-band" />
        {Array.from({ length: 16 }).map((_, i) => (
          <rect
            key={i}
            x={bodyX + 6 + i * (bodyWidth / 16)}
            y={bodyY + 9}
            width={bodyWidth / 16 - 5}
            height="12"
            rx="2"
            className="train-window-pane"
          />
        ))}

        {/* livery stripe */}
        <rect x={bodyX} y={bodyY + 30} width={bodyWidth} height="7" className="train-stripe" />
        <rect x={bodyX} y={bodyY + 38} width={bodyWidth} height="2.5" className="train-stripe-thin" />

        {/* car divider lines */}
        {Array.from({ length: CAR_COUNT - 1 }).map((_, i) => {
          const x = bodyX + ((i + 1) * bodyWidth) / CAR_COUNT;
          return (
            <line
              key={i}
              x1={x}
              y1={bodyY + 4}
              x2={x}
              y2={bodyY + bodyHeight - 4}
              className="train-car-divider"
            />
          );
        })}

        {/* doors: seam lines + handle, roof LED, and connector tick */}
        {doors.map((door, i) => {
          const x = bodyX + i * (doorWidth + doorGap);
          const doorCenter = x + doorWidth / 2;
          const ledY = bodyY - 12;
          return (
            <g key={door.doorId}>
              {/* door panel outline on lower body */}
              <rect
                x={x + 2}
                y={bodyY + 42}
                width={doorWidth - 4}
                height={bodyHeight - 46}
                rx="3"
                className="train-door-panel"
              />
              <rect x={doorCenter - 1} y={bodyY + 50} width="2" height="12" className="train-door-handle" />

              {/* connector tick from roof light down to body */}
              <line x1={doorCenter} y1={ledY + 6} x2={doorCenter} y2={bodyY} className="train-led-tick" />

              {/* LED indicator mount + light */}
              <rect x={doorCenter - 7} y={ledY - 6} width="14" height="10" rx="2" className="train-led-mount" />
              <circle cx={doorCenter} cy={ledY - 1} r="3.4" className={`train-led ${door.density}`} />
            </g>
          );
        })}
      </svg>

      <div className="door-labels">
        {doors.map((door) => (
          <div key={door.doorId} className={`door-label ${door.density}`}>
            <span className="door-id mono">{door.doorId}</span>
            <span className="density-dot" />
            {door.seatsAvailable != null && (
              <div className="seat-section">
                <span className="seat-label">Seats available</span>
                <div className="seat-map">
                  {Array.from({ length: door.seatsTotal }).map((_, i) => (
                    <span
                    key={i}
                    className={`seat-icon${i < door.seatsAvailable ? " seat-free" : ""}`}
                    />
                    ))}
              </div>
        </div>
      )}
    </div>
  ))}
</div>

      <div className="platform-line" />
      <div className="platform-caption">Platform edge</div>

      <div className="density-legend">
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "var(--led-low)" }} />
          Low
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "var(--led-medium)" }} />
          Medium
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "var(--led-high)" }} />
          High
        </span>
      </div>
    </div>
  );
}
