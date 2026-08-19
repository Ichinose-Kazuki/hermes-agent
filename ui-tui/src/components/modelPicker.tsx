import { Box, Text, useInput, useStdout } from '@hermes/ink'
import { useEffect, useMemo, useState } from 'react'

import { providerDisplayNames } from '../domain/providers.js'
import { TUI_SESSION_MODEL_FLAG } from '../domain/slash.js'
import type { GatewayClient } from '../gatewayClient.js'
import type { ModelOptionsResponse } from '../gatewayTypes.js'
import { fuzzyRank } from '../lib/fuzzy.js'
import { modelSearchText } from '../lib/model-search-text.js'
import { asRpcResult, rpcErrorMessage } from '../lib/rpc.js'
import type { Theme } from '../theme.js'

import { OverlayHint, useOverlayKeys, windowItems } from './overlayControls.js'
import { chipRowProps, clampOverlayWidth } from './overlayPrimitives.js'

const VISIBLE = 12
const MIN_WIDTH = 40
const MAX_WIDTH = 90

// A flat model entry remembers which provider it came from so the selection
// routes through switch_model with the right explicit_provider (the endpoint
// and credentials resolve correctly without re-deriving from the model name).
type FlatModel = { model: string; providerSlug: string; providerName: string }

export function ModelPicker({
  allowPersistGlobal = true,
  gw,
  initialRefresh = false,
  maxWidth,
  onCancel,
  onSelect,
  sessionId,
  t
}: ModelPickerProps) {
  const [flatModels, setFlatModels] = useState<FlatModel[]>([])
  const [currentModel, setCurrentModel] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [persistGlobal, setPersistGlobal] = useState(false)
  const [idx, setIdx] = useState(0)
  // Type-to-filter query.
  const [filter, setFilter] = useState('')

  const { stdout } = useStdout()
  // Pin the picker to a stable width so the FloatBox parent (which shrinks-
  // to-fit with alignSelf="flex-start") doesn't resize as long model names
  // scroll into view, and so `wrap="truncate-end"` on each row has an actual
  // constraint to truncate against. Optional maxWidth lets grid layouts hand
  // the picker its cell budget.
  const preferredWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, (stdout?.columns ?? 80) - 6))
  const width = clampOverlayWidth(preferredWidth, maxWidth)

  useEffect(() => {
    gw.request<ModelOptionsResponse>('model.options', {
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(initialRefresh ? { refresh: true } : {}),
      // The sandbox runs only a couple of authenticated providers (anthropic
      // + one custom endpoint) with short model lists, so a single flat list
      // of their models is the whole picker — no provider stage, no
      // unconfigured-provider universe. Mirrors the cli.py /model picker
      // (commit 5c5a3920e), which the TUI picker had diverged from.
      include_unconfigured: false
    })
      .then(raw => {
        const r = asRpcResult<ModelOptionsResponse>(raw)

        if (!r) {
          setErr('invalid response: model.options')
          setLoading(false)

          return
        }

        const providers = r.providers ?? []
        const names = providerDisplayNames(providers)
        // Fold every authenticated provider's models into one flat list,
        // keeping the first occurrence of a duplicate model name (provider
        // order from model.options; the current provider is first). Each
        // model remembers which provider it came from so /model routes the
        // selection through switch_model with the right explicit_provider.
        const seen = new Set<string>()
        const acc: FlatModel[] = []
        providers.forEach((p, i) => {
          const providerName = names[i] ?? p.name ?? p.slug

          for (const m of p.models ?? []) {
            if (seen.has(m)) {
              continue
            }

            seen.add(m)
            acc.push({ model: m, providerSlug: p.slug, providerName })
          }
        })
        setFlatModels(acc)
        setCurrentModel(String(r.model ?? ''))
        setIdx(Math.max(0, acc.findIndex(f => f.model === r.model)))
        setErr('')
        setLoading(false)
      })
      .catch((e: unknown) => {
        setErr(rpcErrorMessage(e))
        setLoading(false)
      })
  }, [gw, initialRefresh, sessionId])

  const filtered = useMemo(() => {
    if (!filter.trim()) {
      return flatModels
    }

    // modelSearchText adds aliases for brand-less wire ids (e.g. Kimi Coding
    // `k3` still matches a "kimi" query). Also match the owning provider's
    // display name / slug so typing a provider name narrows to its models.
    return fuzzyRank(flatModels, filter, f => `${f.model} ${f.providerName} ${f.providerSlug} ${modelSearchText(f.model)}`).map(
      r => r.item
    )
  }, [flatModels, filter])

  // Keep the active selection within the (possibly filtered) list bounds.
  useEffect(() => {
    if (idx >= filtered.length && filtered.length > 0) {
      setIdx(0)
    }
  }, [filtered.length, idx])

  const back = () => {
    // Esc first clears an active filter before cancelling.
    if (filter.trim()) {
      setFilter('')
      setIdx(0)

      return
    }

    onCancel()
  }

  // On the list stage we capture printable keys (including 'q') into the
  // filter, so the shared overlay q/Esc handler must yield to our own handler.
  useOverlayKeys({ disabled: true, onBack: back, onClose: onCancel })

  useInput((ch, key) => {
    if (key.escape) {
      back()

      return
    }

    if (ch === 'q' && !filter) {
      onCancel()

      return
    }

    if (key.upArrow && idx > 0) {
      setIdx(v => v - 1)

      return
    }

    if (key.downArrow && idx < filtered.length - 1) {
      setIdx(v => v + 1)

      return
    }

    if (key.return) {
      const entry = filtered[idx]

      if (entry) {
        onSelect(
          `${entry.model} --provider ${entry.providerSlug}${allowPersistGlobal && persistGlobal ? ' --global' : ` ${TUI_SESSION_MODEL_FLAG}`}`
        )
      }

      return
    }

    // Backspace removes the last filter character; Esc (above) clears a
    // non-empty filter before cancelling.
    if (key.backspace || key.delete) {
      setFilter(v => v.slice(0, -1))
      setIdx(0)

      return
    }

    // Ctrl+U clears the filter. (Ctrl held → ch is the key name 'u'.)
    if (key.ctrl && ch === 'u') {
      setFilter('')
      setIdx(0)

      return
    }

    // Persist-global toggle moved to Ctrl+G so 'g' can be typed into the
    // filter. With Ctrl held, @hermes/ink reports `ch` as the key name ('g'),
    // not the raw control byte (see input-event.ts: input = ctrl ? name : seq).
    if (allowPersistGlobal && key.ctrl && ch === 'g') {
      setPersistGlobal(v => !v)

      return
    }

    // Any other printable single character extends the filter.
    if (ch && !key.ctrl && !key.meta && ch.length === 1 && ch >= ' ') {
      setFilter(v => v + ch)
      setIdx(0)
    }
  })

  if (loading) {
    return <Text color={t.color.muted}>loading models…</Text>
  }

  if (err) {
    return (
      <Box flexDirection="column">
        <Text color={t.color.label}>error: {err}</Text>
        <OverlayHint t={t}>Esc/q cancel</OverlayHint>
      </Box>
    )
  }

  if (!flatModels.length) {
    return (
      <Box flexDirection="column">
        <Text color={t.color.muted}>no models available</Text>
        <OverlayHint t={t}>Esc/q cancel</OverlayHint>
      </Box>
    )
  }

  // ── Flat model list ──────────────────────────────────────────────────
  const rows = filtered.map(f => {
    const prefix = f.model === currentModel ? '* ' : '  '

    return `${prefix}${f.model} · ${f.providerName}`
  })

  const { items, offset } = windowItems(rows, idx, VISIBLE)
  const noMatches = !!filter.trim() && rows.length === 0
  const currentEntry = filtered[idx]

  return (
    <Box flexDirection="column" width={width}>
      <Text bold color={t.color.accent} wrap="truncate-end">
        Select model
      </Text>

      <Text color={t.color.muted} wrap="truncate-end">
        Current: {currentModel || '(unknown)'} ({flatModels.length} models)
      </Text>
      <Text color={filter ? t.color.accent : t.color.muted} wrap="truncate-end">
        {filter ? `filter: ${filter}▎` : 'type to filter · ↑/↓ select'}
      </Text>
      <Text color={t.color.label} wrap="truncate-end">
        {currentEntry?.providerName ? `via ${currentEntry.providerName}` : ' '}
      </Text>
      <Text color={t.color.muted} wrap="truncate-end">
        {offset > 0 ? ` ↑ ${offset} more` : ' '}
      </Text>

      {noMatches ? (
        <Text color={t.color.muted} wrap="truncate-end">
          no models match filter
        </Text>
      ) : (
        Array.from({ length: VISIBLE }, (_, i) => {
          const row = items[i]
          const rowIdx = offset + i
          const entry = filtered[rowIdx]

          return row ? (
            <Text
              color={t.color.muted}
              {...chipRowProps(t, idx === rowIdx)}
              key={`${entry?.providerSlug ?? 'prov'}:${rowIdx}:${entry?.model ?? row}`}
              wrap="truncate-end"
            >
              {idx === rowIdx ? '▸ ' : '  '}
              {rowIdx + 1}. {row}
            </Text>
          ) : (
            <Text color={t.color.muted} key={`pad-${i}`} wrap="truncate-end">
              {' '}
            </Text>
          )
        })
      )}

      <Text color={t.color.muted} wrap="truncate-end">
        {offset + VISIBLE < rows.length ? ` ↓ ${rows.length - offset - VISIBLE} more` : ' '}
      </Text>

      <Text color={t.color.muted} wrap="truncate-end">
        persist: {allowPersistGlobal ? (persistGlobal ? 'global' : 'session') : 'session'}
        {allowPersistGlobal ? ' · ^g toggle' : ' only'}
      </Text>
      <OverlayHint t={t}>↑/↓ select · Enter switch · Esc clear/back · q close</OverlayHint>
    </Box>
  )
}

interface ModelPickerProps {
  allowPersistGlobal?: boolean
  gw: GatewayClient
  initialRefresh?: boolean
  maxWidth?: number
  onCancel: () => void
  onSelect: (value: string) => void
  sessionId: string | null
  t: Theme
}
