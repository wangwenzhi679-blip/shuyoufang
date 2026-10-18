import React, { useId, useMemo, useState } from 'react';
import { REVIEW_RHYTHM_STAGES, summarizeReviewRhythm } from '../../shared/review-rhythm.mjs';
import './review-rhythm.css';

const PLOT_TOP = 26;
const PLOT_BOTTOM = 206;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP; // 180px -> 1.8px per 1%
const ORIGIN_X = 64;
const END_X = 982;
// Non-linear X positions that progressively widen as intervals grow (1 -> 3 -> 7 -> 14 -> 30 days)
const NODE_X = Object.freeze([200, 354, 526, 714, 912]);
const Y_TICKS = Object.freeze([100, 80, 60, 40, 20, 0]);

function yAt(retentionPct) {
  return +(PLOT_BOTTOM - (retentionPct / 100) * PLOT_HEIGHT).toFixed(2);
}

function buildExponentialSegment(x0, pct0, x1, pct1, k = 2.2, steps = 18) {
  const denom = 1 - Math.exp(-k);
  let path = '';
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const x = +(x0 + (x1 - x0) * u).toFixed(2);
    const ratio = (Math.exp(-k * u) - Math.exp(-k)) / denom;
    const pct = pct1 + (pct0 - pct1) * ratio;
    const y = yAt(pct);
    path += ` L${x} ${y}`;
  }
  return path;
}

function buildCurves() {
  const startY = yAt(100);
  let reviewedPath = `M${ORIGIN_X} ${startY}`;
  let prevX = ORIGIN_X;
  const boostSegments = [];
  const nodes = [];

  REVIEW_RHYTHM_STAGES.forEach((stage, idx) => {
    const x = NODE_X[idx];
    const valleyY = yAt(stage.retentionBefore);
    const peakY = yAt(stage.retentionAfter);
    const decayPart =
      `M${prevX} ${startY}` +
      buildExponentialSegment(prevX, 100, x, stage.retentionBefore, stage.decayK, 20);
    reviewedPath += buildExponentialSegment(prevX, 100, x, stage.retentionBefore, stage.decayK, 20);
    reviewedPath += ` L${x} ${peakY}`;
    boostSegments.push({
      round: stage.round,
      day: stage.day,
      x,
      valleyY,
      peakY,
      decayPart,
    });
    nodes.push({
      ...stage,
      x,
      valleyY,
      peakY,
      forgottenY: yAt(stage.forgottenRetention),
    });
    prevX = x;
  });

  // Tail after 5th review (day 30 -> long-term retention > 90%)
  const tailPart = buildExponentialSegment(prevX, 100, END_X, 91, 1.0, 12);
  reviewedPath += tailPart;

  // Natural forgetting curve (without review: 100% -> 33% -> 26% -> 22% -> 19% -> 16% -> 15%)
  const naturalTargets = [
    [ORIGIN_X, 100, 0],
    [NODE_X[0], 33, 2.9],
    [NODE_X[1], 26, 1.7],
    [NODE_X[2], 22, 1.5],
    [NODE_X[3], 19, 1.3],
    [NODE_X[4], 16, 1.2],
    [END_X, 15, 1.0],
  ];
  let naturalPath = `M${ORIGIN_X} ${startY}`;
  for (let i = 1; i < naturalTargets.length; i++) {
    const [x0, p0] = naturalTargets[i - 1];
    const [x1, p1, k] = naturalTargets[i];
    naturalPath += buildExponentialSegment(x0, p0, x1, p1, k, 14);
  }

  const areaPath = `${reviewedPath} L${END_X} ${PLOT_BOTTOM} L${ORIGIN_X} ${PLOT_BOTTOM} Z`;
  return {
    reviewedPath,
    naturalPath,
    areaPath,
    boostSegments,
    nodes,
    startY,
    tailEndY: yAt(91),
    naturalEndY: yAt(15),
  };
}

const CURVE_DATA = buildCurves();

export default function ReviewRhythm({
  tasks = [],
  today = '',
  rhythm,
  selectedRound = null,
  onSelectRound,
  onChooseQuestions,
}) {
  const uid = useId().replace(/:/g, '');
  const washId = `review-wash-${uid}`;
  const zoneId = `review-zone-${uid}`;
  const [hoveredRound, setHoveredRound] = useState(null);

  const summary = useMemo(
    () => rhythm || summarizeReviewRhythm(tasks, today),
    [rhythm, tasks, today],
  );

  const activeRoundNumber =
    hoveredRound ??
    selectedRound ??
    (summary.rounds.find((r) => r.due > 0)?.round ||
      summary.rounds.find((r) => r.pending > 0)?.round ||
      1);
  const activeStage =
    summary.rounds.find((r) => r.round === activeRoundNumber) || summary.rounds[0];

  function handleRoundClick(round) {
    if (!onSelectRound) return;
    onSelectRound(selectedRound === round ? null : round);
  }

  return (
    <section className="review-rhythm" aria-label="间隔复习节奏">
      <header className="rhy-heading">
        <div>
          <span className="rhy-eyebrow">温故 · 留住每一次所得</span>
          <h2>艾宾浩斯遗忘曲线</h2>
          <p>
            遵循「先密后疏」的五轮间隔节奏，在每次遗忘临界点及时回看，将瞬时印象沉淀为长期掌握。
          </p>
        </div>
        <div className="rhy-live-summary" aria-label="当前账号复习节奏概览">
          <div className="rhy-stat-pill">
            <span>入列错题</span>
            <strong>
              {summary.totals.questionCount} <small>题</small>
            </strong>
          </div>
          <div className={`rhy-stat-pill ${summary.totals.dueCount > 0 ? 'is-due' : ''}`}>
            <span>{summary.totals.dueCount > 0 ? '今日待看' : '待复习'}</span>
            <strong>
              {summary.totals.dueCount > 0 ? summary.totals.dueCount : summary.totals.pendingCount}{' '}
              <small>次</small>
            </strong>
          </div>
          <div className="rhy-stat-pill">
            <span>已巩固</span>
            <strong>
              {summary.totals.completedCount} <small>次</small>
            </strong>
          </div>
        </div>
      </header>

      <figure className="rhy-chart">
        <div className="rhy-plot-meta">
          <span className="rhy-axis-title">记忆保持率 (%) · 非线性时间轴</span>
          <div className="rhy-legend" aria-label="图例说明">
            <span>
              <i className="rhy-reviewed" />
              间隔复习保留率
            </span>
            <span>
              <i className="rhy-jump-icon" />
              复习节点提振
            </span>
            <span>
              <i className="rhy-forgotten" />
              不复习自然遗忘
            </span>
            <span>
              <i className="rhy-zone-icon" />
              长期记忆区 (≥85%)
            </span>
          </div>
        </div>

        <div className="rhy-plot">
          <div className="rhy-y-axis" aria-hidden="true">
            {Y_TICKS.map((pct) => (
              <span key={pct} style={{ top: `${(yAt(pct) / 240) * 100}%` }}>
                {pct}%
              </span>
            ))}
          </div>

          <svg
            viewBox="0 0 1000 240"
            preserveAspectRatio="none"
            role="img"
            aria-label="艾宾浩斯遗忘与间隔复习曲线：灰色虚线表示不复习时的自然遗忘，从100%迅速跌至15%左右；墨绿色锯齿曲线表示在第1、3、7、14、30天共五轮复习后，每次将记忆拉回100%并减缓后续遗忘，最终稳定在90%以上。"
          >
            <defs>
              <linearGradient id={washId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6e865f" stopOpacity=".22" />
                <stop offset="75%" stopColor="#81976d" stopOpacity=".06" />
                <stop offset="100%" stopColor="#81976d" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={zoneId} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#81976d" stopOpacity=".05" />
                <stop offset="100%" stopColor="#81976d" stopOpacity=".13" />
              </linearGradient>
            </defs>

            {/* Long-term memory zone >= 85% */}
            <rect
              x={ORIGIN_X}
              y={PLOT_TOP}
              width={END_X - ORIGIN_X}
              height={yAt(85) - PLOT_TOP}
              fill={`url(#${zoneId})`}
            />

            {/* Horizontal percentage grid lines */}
            {Y_TICKS.slice(0, -1).map((pct) => {
              const y = yAt(pct);
              return (
                <path
                  key={pct}
                  d={`M${ORIGIN_X} ${y}H${END_X}`}
                  className="rhy-grid"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {/* Vertical guide lines for origin and 5 review days */}
            <path
              d={`M${ORIGIN_X} ${PLOT_TOP}V${PLOT_BOTTOM}`}
              className="rhy-vguide is-origin"
              vectorEffect="non-scaling-stroke"
            />
            {CURVE_DATA.nodes.map((node) => (
              <path
                key={node.day}
                d={`M${node.x} ${PLOT_TOP}V${PLOT_BOTTOM}`}
                className={`rhy-vguide ${activeRoundNumber === node.round ? 'is-active' : ''}`}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Area wash under spaced review curve */}
            <path d={CURVE_DATA.areaPath} fill={`url(#${washId})`} />

            {/* Natural forgetting curve */}
            <path
              d={CURVE_DATA.naturalPath}
              className="rhy-decay"
              vectorEffect="non-scaling-stroke"
            />

            {/* Spaced review curve (exponential decay + vertical review boost) */}
            <path
              d={CURVE_DATA.reviewedPath}
              className="rhy-boost"
              vectorEffect="non-scaling-stroke"
            />

            {/* Highlighted vertical boost segments at each review day */}
            {CURVE_DATA.boostSegments.map((seg) => (
              <path
                key={seg.round}
                d={`M${seg.x} ${seg.valleyY}L${seg.x} ${seg.peakY}`}
                className={`rhy-boost-jump ${activeRoundNumber === seg.round ? 'is-active' : ''}`}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Baseline X axis */}
            <path
              d={`M${ORIGIN_X} ${PLOT_BOTTOM}H${END_X}`}
              className="rhy-axis"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Interactive DOM overlay for crisp circles, badges, and labels */}
          <div className="rhy-review-nodes">
            {/* Origin point: Day 0 Initial Learning */}
            <div
              className="rhy-origin-node"
              style={{ left: `${ORIGIN_X / 10}%`, top: `${(CURVE_DATA.startY / 240) * 100}%` }}
              title="初次学习（起点）：初始记忆保持率 100%"
            >
              <span className="rhy-origin-dot" />
              <span className="rhy-origin-tag">初记 100%</span>
            </div>

            {/* 5 Review Round Nodes (Valley + Peak) */}
            {CURVE_DATA.nodes.map((node, index) => {
              const roundStat = summary.rounds[index];
              const isActive = activeRoundNumber === node.round;
              const isSelected = selectedRound === node.round;
              const hasDue = roundStat.due > 0;
              const hasPending = roundStat.pending > 0;
              return (
                <React.Fragment key={node.day}>
                  {/* Pre-review valley marker */}
                  <div
                    className={`rhy-valley-node ${isActive ? 'is-active' : ''}`}
                    style={{ left: `${node.x / 10}%`, top: `${(node.valleyY / 240) * 100}%` }}
                    aria-hidden="true"
                  >
                    <span className="rhy-valley-dot" />
                    <span className="rhy-valley-label">{node.retentionBefore}%</span>
                  </div>

                  {/* Post-review peak interactive button */}
                  <button
                    type="button"
                    className={`rhy-point ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''} ${hasDue ? 'has-due' : hasPending ? 'has-pending' : roundStat.completed > 0 ? 'has-done' : ''}`}
                    style={{ left: `${node.x / 10}%`, top: `${(node.peakY / 240) * 100}%` }}
                    aria-pressed={isSelected}
                    aria-label={`${node.label}（${node.dayLabel}·${node.title}）：复习前约保留 ${node.retentionBefore}%，复习后提振至 100%。待复习 ${roundStat.pending} 道，已完成 ${roundStat.completed} 道。`}
                    onMouseEnter={() => setHoveredRound(node.round)}
                    onMouseLeave={() => setHoveredRound(null)}
                    onFocus={() => setHoveredRound(node.round)}
                    onBlur={() => setHoveredRound(null)}
                    onClick={() => handleRoundClick(node.round)}
                  >
                    <span className="rhy-point-ring" />
                    <span className="rhy-point-badge">
                      {node.label}
                      {roundStat.total > 0 && (
                        <em>
                          {hasDue
                            ? `待看 ${roundStat.due}`
                            : hasPending
                              ? `${roundStat.pending}`
                              : `✓${roundStat.completed}`}
                        </em>
                      )}
                    </span>
                  </button>
                </React.Fragment>
              );
            })}

            {/* End-of-curve annotations */}
            <span
              className="rhy-curve-end is-reviewed"
              style={{ left: `${END_X / 10}%`, top: `${(CURVE_DATA.tailEndY / 240) * 100}%` }}
              aria-hidden="true"
            >
              长期留存 &gt;90%
            </span>
            <span
              className="rhy-curve-end is-natural"
              style={{ left: `${END_X / 10}%`, top: `${(CURVE_DATA.naturalEndY / 240) * 100}%` }}
              aria-hidden="true"
            >
              不复习 ≈15%
            </span>
          </div>
        </div>

        {/* Aligned Time Axis ticks */}
        <div className="rhy-time-axis" aria-label="建议在第1、3、7、14、30天复习">
          <span className="rhy-time-origin" style={{ left: `${ORIGIN_X / 10}%` }}>
            起点
          </span>
          {CURVE_DATA.nodes.map((node) => (
            <span
              key={node.day}
              className={activeRoundNumber === node.round ? 'is-active' : ''}
              style={{ left: `${node.x / 10}%` }}
            >
              第 {node.day} 天
            </span>
          ))}
          <small>复习节点</small>
        </div>

        {/* 5-Round Interactive Rhythm Cards with live account task counts */}
        <div className="rhy-stage-grid" role="group" aria-label="五轮复习节点与实时题量">
          {summary.rounds.map((stage) => {
            const isActive = activeRoundNumber === stage.round;
            const isSelected = selectedRound === stage.round;
            return (
              <button
                key={stage.round}
                type="button"
                className={`rhy-stage-card ${isActive ? 'is-active' : ''} ${isSelected ? 'is-selected' : ''}`}
                aria-pressed={isSelected}
                onMouseEnter={() => setHoveredRound(stage.round)}
                onMouseLeave={() => setHoveredRound(null)}
                onFocus={() => setHoveredRound(stage.round)}
                onBlur={() => setHoveredRound(null)}
                onClick={() => handleRoundClick(stage.round)}
              >
                <div className="rhy-stage-top">
                  <strong>
                    {stage.label} · {stage.dayLabel}
                  </strong>
                  <span className="rhy-stage-title">{stage.title}</span>
                </div>
                <div className="rhy-stage-retention">
                  <span>记忆提振</span>
                  <b>
                    {stage.retentionBefore}% → {stage.retentionAfter}%
                  </b>
                </div>
                <div className="rhy-stage-counts">
                  {stage.due > 0 ? (
                    <span className="rhy-count-tag is-due">今日待看 {stage.due}</span>
                  ) : stage.pending > 0 ? (
                    <span className="rhy-count-tag is-pending">待复习 {stage.pending}</span>
                  ) : stage.completed > 0 ? (
                    <span className="rhy-count-tag is-done">已巩固 {stage.completed}</span>
                  ) : (
                    <span className="rhy-count-tag is-empty">暂无排期</span>
                  )}
                  {stage.pending > 0 && stage.completed > 0 && (
                    <small>已完成 {stage.completed}</small>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Active Stage Detail & Filter Bar */}
        {activeStage && (
          <div className="rhy-stage-detail" role="status" aria-live="polite">
            <div className="rhy-stage-detail-main">
              <span className="rhy-detail-badge">
                {activeStage.label} · {activeStage.dayLabel} · {activeStage.title}
              </span>
              <p>
                {activeStage.note}
                <span className="rhy-detail-metrics">
                  （不复习约剩 {activeStage.forgottenRetention}% · 按时复习前约保{' '}
                  {activeStage.retentionBefore}% → 复习后恢复 100%）
                </span>
              </p>
            </div>
            <div className="rhy-stage-detail-side">
              <span>
                本轮待复习 <strong>{activeStage.pending}</strong> 次 · 已完成{' '}
                <strong>{activeStage.completed}</strong> 次
              </span>
              {onSelectRound && selectedRound !== null && (
                <button
                  type="button"
                  className="rhy-clear-round"
                  onClick={() => onSelectRound(null)}
                >
                  显示全部轮次
                </button>
              )}
            </div>
          </div>
        )}

        <figcaption>
          <span>规律示意 · 点击任一轮次卡片可筛选下方对应轮次的错题复习安排</span>
          <div>
            {onChooseQuestions && (
              <button type="button" className="rhy-choose" onClick={onChooseQuestions}>
                去错题本选题 <span aria-hidden="true">↗</span>
              </button>
            )}
            <a
              href="https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0120644"
              target="_blank"
              rel="noreferrer"
            >
              了解遗忘规律 ↗
            </a>
          </div>
        </figcaption>
      </figure>
    </section>
  );
}
