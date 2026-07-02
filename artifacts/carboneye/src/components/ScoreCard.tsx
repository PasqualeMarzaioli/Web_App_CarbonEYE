/**
 * artifacts/carboneye/src/components/ScoreCard.tsx — Visual card displaying ESG score, letter grade, company name, and timestamp with color coding based on grade.
 * Author: Pasquale Marzaioli
 */
import { GRADE_COLORS } from "../lib/types";

type Props = {
  score: number;
  grade: string;
  company?: string;
  timestamp?: string;
};

export function ScoreCard({ score, grade, company, timestamp }: Props) {
  const color = GRADE_COLORS[grade] ?? "#1a2e1e";
  const isLight = grade === "C+" || grade === "C";
  const textColor = isLight ? "#1a2e1e" : "#ffffff";
  const subColor = isLight ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.7)";

  return (
    <div>
      <div
        className="score-card"
        style={{
          background: color,
          boxShadow: `0 8px 32px ${color}55`,
        }}
      >
        <div className="score-num" style={{ color: textColor }}>
          {Math.round(score)}
        </div>
        <div className="score-grade" style={{ color: textColor }}>
          Grade {grade}
        </div>
        <div className="score-label" style={{ color: subColor }}>
          ESG Score
        </div>
      </div>
      {(company || timestamp) && (
        <div className="asset-info">
          {company && (
            <>
              <strong>Asset:</strong> {company}
              <br />
            </>
          )}
          {timestamp && (
            <>
              <strong>Date:</strong> {timestamp.slice(0, 10)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
