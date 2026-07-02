/**
 * artifacts/carboneye/src/components/Panel.tsx — Generic container component with title, optional badge, and configurable padding for organizing dashboard sections.
 * Author: Pasquale Marzaioli
 */
import type { ReactNode } from "react";

type Props = {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  bodyPadded?: boolean;
};

export function Panel({ title, badge, children, bodyPadded = false }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>{title}</span>
        {badge}
      </div>
      {bodyPadded ? <div style={{ padding: 12 }}>{children}</div> : children}
    </div>
  );
}
