import React from 'react';
import type { Widget } from './widget.js';

/**
 * Renders a generative result widget.
 *
 * NAMED WidgetView, not Widget, because widget.ts sits beside it and macOS is
 * case-insensitive: `./Widget.js` resolves to `widget.ts` there, so the schema
 * module shadowed this one and the build failed on a missing export. Two modules
 * in one directory differing only by case cannot both be imported.
 *
 * Presentational and total: every kind in the union has a branch, and every value
 * arrives as a React child, so it is ESCAPED by construction. There is no
 * dangerouslySetInnerHTML here and there must never be one — the content is written
 * by a model that reads the open web, so treating any of it as markup hands whoever
 * wrote that web page a path into this extension's origin.
 */
export function WidgetView({ widget }: { widget: Widget }) {
  switch (widget.kind) {
    case 'comparison':
      return (
        <section className="ae-widget ae-widget-comparison">
          {widget.title && <h3 className="ae-widget-title">{widget.title}</h3>}
          {/* Its own scroll container: a wide table must never make the PAGE
              scroll sideways. */}
          <div className="ae-widget-scroll">
            <table className="ae-widget-table">
              <thead>
                <tr>
                  {widget.columns.map((c, i) => (
                    <th key={i} scope={i === 0 ? 'row' : 'col'}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {widget.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) =>
                      j === 0 ? (
                        <th key={j} scope="row">
                          {cell}
                        </th>
                      ) : (
                        <td key={j}>{cell}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );

    case 'steps':
      return (
        <section className="ae-widget ae-widget-steps">
          {widget.title && <h3 className="ae-widget-title">{widget.title}</h3>}
          <ol className="ae-widget-steplist">
            {widget.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      );

    case 'stats':
      return (
        <section className="ae-widget ae-widget-stats">
          {widget.title && <h3 className="ae-widget-title">{widget.title}</h3>}
          <div className="ae-widget-statgrid">
            {widget.stats.map((s, i) => (
              <div className="ae-widget-stat" key={i}>
                <span className="ae-widget-statvalue">{s.value}</span>
                <span className="ae-widget-statlabel">{s.label}</span>
              </div>
            ))}
          </div>
        </section>
      );

    case 'timeline':
      return (
        <section className="ae-widget ae-widget-timeline">
          {widget.title && <h3 className="ae-widget-title">{widget.title}</h3>}
          <ol className="ae-widget-events">
            {widget.events.map((e, i) => (
              <li key={i}>
                <span className="ae-widget-when">{e.when}</span>
                <span className="ae-widget-what">{e.what}</span>
              </li>
            ))}
          </ol>
        </section>
      );

    case 'entity':
      return (
        <section className="ae-widget ae-widget-entity">
          <h3 className="ae-widget-title">{widget.title}</h3>
          {widget.subtitle && <p className="ae-widget-subtitle">{widget.subtitle}</p>}
          <dl className="ae-widget-facts">
            {widget.facts.map((f, i) => (
              <React.Fragment key={i}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      );

    case 'definition':
      return (
        <section className="ae-widget ae-widget-definition">
          <h3 className="ae-widget-title">{widget.term}</h3>
          <p className="ae-widget-meaning">{widget.meaning}</p>
          {widget.example && <pre className="ae-widget-example">{widget.example}</pre>}
        </section>
      );
  }
}

/** Renders every widget an answer produced, or nothing. */
export function Widgets({ widgets }: { widgets: Widget[] }) {
  if (!widgets.length) return null;
  return (
    <div className="ae-widgets">
      {widgets.map((w, i) => (
        <WidgetView key={i} widget={w} />
      ))}
    </div>
  );
}
