import type {
  ValuationAssumptions,
  ValuationBasisType,
  ValuationTerminalMethod,
} from '@shared/contract'
import { Button } from '@/components/ui/Button'
import { NumberInput } from '@/components/ui/NumberInput'
import { Select } from '@/components/ui/Select'

/**
 * The Fair Value Assumptions form, ported from `init_page23`'s three assumption groups.
 *
 * Two rows are conditional, exactly as `_valuation_update_dynamic_assumption_rows` makes
 * them: an EPS basis has no terminal *method* to choose (its terminal value is always an
 * exit multiple, and the row is relabelled "Exit P/E"), and Gordon growth and the exit
 * multiple are never both on screen because only one of them is in the formula.
 */

interface AssumptionsPanelProps {
  assumptions: ValuationAssumptions
  onChange: (assumptions: ValuationAssumptions) => void
  onRederive: () => void
  /** The one-line derivation summary; the unabridged version is its tooltip. */
  stateLabel: string
  stateTooltip: string
  canRederive: boolean
  warnings: string[]
  warningTone: 'warning' | 'negative'
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-32 shrink-0 truncate text-2xs text-text-muted" title={label}>
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border border-border bg-surface-raised px-2 py-1.5">
      <h3 className="border-b border-border pb-1 text-2xs tracking-wide text-text-muted uppercase">
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

export function AssumptionsPanel({
  assumptions,
  onChange,
  onRederive,
  stateLabel,
  stateTooltip,
  canRederive,
  warnings,
  warningTone,
}: AssumptionsPanelProps) {
  const isEps = assumptions.basisType === 'EPS'
  const isGordon = !isEps && assumptions.terminalMethod === 'gordon_growth'
  const patch = (values: Partial<ValuationAssumptions>) => onChange({ ...assumptions, ...values })

  return (
    <div className="flex flex-col border border-border bg-surface">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2">
        <h2 className="text-2xs font-semibold tracking-wide text-text uppercase">
          Fair Value Assumptions
        </h2>
        <Button
          className="ml-auto"
          disabled={!canRederive}
          title="Recompute every assumption from the loaded data, discarding manual edits"
          onClick={onRederive}
        >
          Re-derive
        </Button>
      </header>
      {/* The full derivation is several hundred characters, so the line is clamped and the
          unabridged version lives in the tooltip — the same split the reference uses. */}
      <p
        className="line-clamp-2 cursor-help border-b border-border px-2 py-1 text-2xs text-text-dim"
        title={stateTooltip || stateLabel}
      >
        {stateLabel}
      </p>
      <div className="grid items-start gap-2 p-2 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Group title="Starting Metric">
            <Row label="Basis type">
              <Select<ValuationBasisType>
                aria-label="Basis type"
                value={assumptions.basisType}
                options={[
                  { value: 'FCF', label: 'FCF' },
                  { value: 'EPS', label: 'EPS' },
                ]}
                onChange={(basisType) => patch({ basisType })}
              />
            </Row>
            <Row label={isEps ? 'Starting EPS' : 'Starting FCF/share'}>
              <NumberInput
                aria-label="Starting basis value"
                value={assumptions.basisValue}
                decimals={2}
                prefix="$"
                min={0}
                max={100_000}
                onCommit={(basisValue) => patch({ basisValue })}
              />
            </Row>
          </Group>

          <Group title="Forecast">
            <Row label="Growth years 1-5">
              <NumberInput
                aria-label="Growth years 1-5"
                suffix="%"
                value={assumptions.growth1to5}
                decimals={1}
                min={-30}
                max={50}
                onCommit={(growth1to5) => patch({ growth1to5 })}
              />
            </Row>
            <Row label="Growth years 6-N">
              <NumberInput
                aria-label="Growth years 6 to N"
                suffix="%"
                value={assumptions.growth6to10}
                decimals={1}
                min={-15}
                max={30}
                onCommit={(growth6to10) => patch({ growth6to10 })}
              />
            </Row>
            <Row label="Projection years">
              <NumberInput
                aria-label="Projection years"
                suffix="yr"
                value={assumptions.projectionYears}
                decimals={0}
                min={5}
                max={15}
                onCommit={(projectionYears) => patch({ projectionYears })}
              />
            </Row>
          </Group>
        </div>

        <Group title="Risk / Terminal">
          <Row label="Required return">
            <NumberInput
              aria-label="Required return"
              suffix="%"
              value={assumptions.discountRate}
              decimals={1}
              min={4}
              max={30}
              onCommit={(discountRate) => patch({ discountRate })}
            />
          </Row>
          {isEps ? null : (
            <Row label="Terminal method">
              <Select<ValuationTerminalMethod>
                aria-label="Terminal method"
                value={assumptions.terminalMethod}
                options={[
                  { value: 'gordon_growth', label: 'Gordon Growth' },
                  { value: 'exit_multiple', label: 'Exit Multiple' },
                ]}
                onChange={(terminalMethod) => patch({ terminalMethod })}
              />
            </Row>
          )}
          {isGordon ? (
            <Row label="Terminal growth">
              <NumberInput
                aria-label="Terminal growth"
                suffix="%"
                value={assumptions.terminalGrowth}
                decimals={1}
                min={-2}
                max={5}
                onCommit={(terminalGrowth) => patch({ terminalGrowth })}
              />
            </Row>
          ) : (
            <Row label={isEps ? 'Exit P/E' : 'Exit multiple'}>
              <NumberInput
                aria-label="Exit multiple"
                suffix="x"
                value={assumptions.exitMultiple}
                decimals={1}
                min={3}
                max={50}
                onCommit={(exitMultiple) => patch({ exitMultiple })}
              />
            </Row>
          )}
          <Row label="Margin of safety">
            <NumberInput
              aria-label="Margin of safety"
              suffix="%"
              value={assumptions.marginOfSafety}
              decimals={1}
              min={0}
              max={50}
              onCommit={(marginOfSafety) => patch({ marginOfSafety })}
            />
          </Row>
        </Group>
      </div>

      {warnings.length ? (
        <p
          className={`mx-2 mb-2 border px-2 py-1 text-2xs ${
            warningTone === 'negative'
              ? 'border-down bg-down-bg text-down'
              : 'border-warn text-warn'
          }`}
        >
          {warnings.join(' ')}
        </p>
      ) : null}
    </div>
  )
}
