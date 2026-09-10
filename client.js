// 「烧了么」Client half (pkg-44)
// This file is the exact `code.client` body passed to cordis_define: a plain
// JavaScript function body that `return`s a Cordis Plugin. It runs in the
// browser page, injects `slots` + `timer`, registers the overlay and the
// conversation-header seat, and talks to the Host via host.call('snapshot'|'setRate').
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    const store = { sessionId: undefined, data: undefined, busy: false, error: undefined }
    const listeners = new Set()
    const notify = () => { for (const fn of listeners) fn() }
    const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

    styles.insert(
      '.tf-folder{display:grid;grid-template-rows:0fr;transition:grid-template-rows .24s cubic-bezier(.4,0,.2,1)}' +
      '.tf-folder.tf-on{grid-template-rows:1fr}' +
      '.tf-inner{overflow:hidden;min-height:0;opacity:0;transform:translateY(4px);' +
      'transition:opacity .18s ease,transform .24s cubic-bezier(.4,0,.2,1)}' +
      '.tf-folder.tf-on .tf-inner{opacity:1;transform:translateY(0)}')

    async function refresh(force) {
      if (store.busy && !force) return
      const sid = store.sessionId
      if (sid === undefined) return
      store.busy = true
      try {
        const res = await host.call('snapshot', { sessionId: sid })
        if (!res || res.ok !== true) {
          if (store.sessionId === sid) { store.error = 'read-failed'; notify() }
          return
        }
        if (store.sessionId !== sid) return
        store.data = res.available ? res.view : null
        store.error = undefined
        notify()
      } catch (err) {
        if (store.sessionId === sid) { store.error = 'call-failed'; notify() }
      } finally {
        store.busy = false
      }
    }
    ctx.interval(() => { void refresh(false) }, 1500)

    const fmtInt = (v) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const fmtK = (v) => {
      const n = Number(v) || 0
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
      return String(Math.round(n))
    }
    const fmtYuan = (v) => {
      const n = Number(v) || 0
      if (n === 0) return '0.0000'
      const abs = Math.abs(n)
      const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : abs >= 0.0001 ? 4 : 6
      return n.toFixed(digits)
    }
    const parseNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0 }
    const clampNum = (v, lo, hi) => Math.max(lo, Math.min(v, hi))

    function useAnimNum(value) {
      const [disp, setDisp] = React.useState(value)
      const fromRef = React.useRef(value)
      React.useEffect(() => {
        const from = fromRef.current
        const to = Number(value) || 0
        fromRef.current = to
        if (from === to) { setDisp(to); return }
        if (typeof requestAnimationFrame !== 'function') { setDisp(to); return }
        const start = Date.now()
        let raf = 0
        const tick = () => {
          const p = Math.min(1, (Date.now() - start) / 420)
          const eased = 1 - Math.pow(1 - p, 3)
          const cur = from + (to - from) * eased
          setDisp(cur)
          if (p < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => { if (raf) cancelAnimationFrame(raf) }
      }, [value])
      return disp
    }

    function SeatView(props) {
      const sid = props.sessionId
      React.useEffect(() => {
        if (store.sessionId !== sid) {
          store.sessionId = sid
          store.data = undefined
          notify()
          void refresh(true)
        }
      }, [sid])
      return null
    }

    // Single morphing card. Screen edges act as walls: mid-screen the card
    // expands around the mouse; near the bottom wall it folds UP instead (its
    // bottom edge stays pinned to the bubble). Hover opens/closes immediately
    // (no delays). Collapse of the open card is triggered only by an actual
    // drag and is a whole-box JS shrink that follows the cursor smoothly.
    function Overlay() {
      const [, setVersion] = React.useState(0)
      React.useEffect(() => subscribe(() => setVersion(v => v + 1)), [])
      const [open, setOpen] = React.useState(false)
      const [wide, setWide] = React.useState(false)
      const [foldUp, setFoldUp] = React.useState(false)
      const [gW, setGW] = React.useState(null)
      const [gH, setGH] = React.useState(null)
      const [pos, setPos] = React.useState(null)
      const [target, setTarget] = React.useState(null)
      const [dragging, setDragging] = React.useState(false)
      const [showRates, setShowRates] = React.useState(false)
      const [drafts, setDrafts] = React.useState({})
      const rootRef = React.useRef(null)
      const summaryRef = React.useRef(null)
      const innerRef = React.useRef(null)
      const rulerRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const hoverSuppress = React.useRef(false)
      const openTRef = React.useRef(null)
      const lastCloseAt = React.useRef(0)
      const phaseRef = React.useRef(0)
      const W = 320
      const data = store.data
      const sid = store.sessionId
      const seq = data ? data.seq : 0

      const aYuan = useAnimNum(data ? data.yuan : 0)
      const aTotal = useAnimNum(data ? data.tokens.total : 0)
      const aInput = useAnimNum(data ? data.tokens.input : 0)
      const aOutput = useAnimNum(data ? data.tokens.output : 0)
      const aCache = useAnimNum(data ? data.tokens.cacheRead : 0)
      const aReason = useAnimNum(data ? data.tokens.reasoning : 0)
      const aCalls = useAnimNum(data ? data.calls : 0)

      const blockStyle = {
        position: 'fixed', zIndex: 2147483001, pointerEvents: 'auto',
        boxSizing: 'border-box', maxWidth: 340,
        display: 'flex', flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        background: 'rgba(13, 17, 28, 0.93)', color: '#e8eaf2',
        border: '1px solid rgba(255,255,255,0.16)', borderRadius: 14, overflow: 'hidden',
        padding: '8px 12px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.42)', backdropFilter: 'blur(10px)',
        fontSize: 12, lineHeight: 1.45, userSelect: 'none', touchAction: 'none',
        cursor: 'grab',
      }
      const row = { display: 'flex', justifyContent: 'space-between', gap: 14, marginTop: 2 }
      const inputStyle = {
        width: 50, boxSizing: 'border-box',
        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.22)',
        color: '#e8eaf2', borderRadius: 6, padding: '2px 4px', fontSize: 11,
      }

      const cancelTimers = () => {
        if (openTRef.current) { openTRef.current(); openTRef.current = null }
      }
      const fitClosedWidth = () => {
        setPos(prev => {
          if (prev === null) return prev
          let textW = 0
          if (summaryRef.current) textW = summaryRef.current.scrollWidth
          if (textW <= 0 && rootRef.current) textW = rootRef.current.scrollWidth
          const w = Math.min(Math.ceil(textW) + 26, 340)
          if (Math.abs(prev.w - w) <= 1) return prev
          return Object.assign({}, prev, { w })
        })
      }
      const measureClosed = () => {
        if (open) return
        if (Date.now() - lastCloseAt.current < 260) return
        fitClosedWidth()
      }

      React.useEffect(() => {
        if (pos !== null) return
        const el = rootRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        const view = el.ownerDocument.defaultView
        lastCloseAt.current = 0
        setPos({
          x: Math.round(r.left), y: Math.round(r.top),
          vw: view ? view.innerWidth : r.right + r.width,
          vh: view ? view.innerHeight : r.bottom + r.height,
          w: Math.round(r.width), h: Math.round(r.height),
        })
        fitClosedWidth()
      }, [])
      React.useEffect(() => {
        if (open) return
        const id = requestAnimationFrame(() => { cancelTimers(); measureClosed() })
        return () => cancelAnimationFrame(id)
      }, [seq])
      React.useEffect(() => {
        if (open) return
        const id = requestAnimationFrame(() => measureClosed())
        return () => cancelAnimationFrame(id)
      })

      const openNow = (mx, my) => {
        phaseRef.current += 1
        lastCloseAt.current = 0
        if (pos === null) {
          setWide(true)
          setOpen(true)
          return
        }
        const S = summaryRef.current ? summaryRef.current.offsetHeight : 20
        const F = rulerRef.current ? Math.max(0, rulerRef.current.offsetHeight) : 150
        const H = 2 + 8 + F + S + 8
        const bubbleCenterY = pos.y + pos.h / 2
        const flip = bubbleCenterY > pos.vh - H / 2 - 2
        let t = null
        if (flip) {
          t = { x: clampNum(pos.x, 2, Math.max(2, pos.vw - W - 2)), y: 0 }
        } else {
          const x = clampNum(mx - W / 2, 6, Math.max(6, pos.vw - W - 6))
          const y = clampNum(my - H / 2, 2, Math.max(2, pos.vh - H - 2))
          t = { x: Math.round(x), y: Math.round(y) }
        }
        setFoldUp(flip)
        setTarget(t)
        setWide(true)
        setOpen(true)
      }
      const closeIt = () => {
        phaseRef.current += 1
        lastCloseAt.current = Date.now()
        fitClosedWidth()
        setWide(false)
        setOpen(false)
      }
      const onEnter = (e) => {
        if (hoverSuppress.current || !data) return
        if (open) return
        openNow(e.clientX, e.clientY)
      }
      const onLeave = () => {
        hoverSuppress.current = false
        if (dragRef.current) return
        if (openTRef.current) { openTRef.current(); openTRef.current = null }
        closeIt()
      }

      // ---- whole-box JS collapse while dragging the open card ----
      const tickCollapse = () => {
        const d = dragRef.current
        if (!d || d.mode !== 'collapse') return
        const p0 = Math.min(1, (Date.now() - d.cStart) / 230)
        const p = 1 - Math.pow(1 - p0, 3)
        const w = Math.round(d.w0 + (d.cw - d.w0) * p)
        const h = Math.round(d.h0 + (d.ch - d.h0) * p)
        const cx = d.c0x + (d.latestX - d.c0x) * p
        const cy = d.c0y + (d.latestY - d.c0y) * p
        const x = clampNum(cx - w / 2, 4, Math.max(4, d.vw - w - 4))
        const y = clampNum(cy - h / 2, 4, Math.max(4, d.vh - h - 4))
        setGW(w)
        setGH(h)
        setPos(prev => prev ? Object.assign({}, prev, { x: Math.round(x), y: Math.round(y), vw: d.vw, vh: d.vh }) : prev)
        if (p0 >= 1) {
          setGW(null)
          setGH(null)
          d.mode = 'center'
          d.w = d.cw
          d.h = d.ch
          const fx = clampNum(d.latestX - d.cw / 2, 4, Math.max(4, d.vw - d.cw - 4))
          const fy = clampNum(d.latestY - d.ch / 2, 4, Math.max(4, d.vh - d.ch - 4))
          setPos(prev => prev ? Object.assign({}, prev, { x: Math.round(fx), y: Math.round(fy) }) : prev)
          return
        }
        d.raf = requestAnimationFrame(tickCollapse)
      }
      const startCollapse = () => {
        const d = dragRef.current
        if (!d) return
        lastCloseAt.current = Date.now()
        const el = rootRef.current
        const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: W, height: 120 }
        d.w0 = r.width
        d.h0 = r.height
        d.c0x = r.left + r.width / 2
        d.c0y = r.top + r.height / 2
        d.cStart = Date.now()
        setFoldUp(false)
        setOpen(false)
        setWide(false)
        setDragging(true)
        setGW(r.width)
        setGH(r.height)
        d.mode = 'collapse'
        d.raf = requestAnimationFrame(tickCollapse)
      }
      const moveDrag = (e) => {
        const d = dragRef.current
        if (!d) return
        d.latestX = e.clientX
        d.latestY = e.clientY
        const view = e.view
        d.vw = view && Number.isFinite(view.innerWidth) ? view.innerWidth : d.vw
        d.vh = view && Number.isFinite(view.innerHeight) ? view.innerHeight : d.vh
        const vw = d.vw, vh = d.vh
        if (d.mode === 'pending') {
          const dist = Math.max(Math.abs(d.latestX - d.startX), Math.abs(d.latestY - d.startY))
          if (dist < 4) return
          startCollapse()
          return
        }
        if (d.mode === 'collapse') return
        if (d.mode === 'center') {
          const x = clampNum(d.latestX - d.w / 2, 4, Math.max(4, vw - d.w - 4))
          const y = clampNum(d.latestY - d.h / 2, 4, Math.max(4, vh - d.h - 4))
          setPos(prev => prev ? Object.assign({}, prev, { x: Math.round(x), y: Math.round(y), vw, vh }) : prev)
          return
        }
        let x = d.fromX + (d.latestX - d.startX)
        let y = d.fromY + (d.latestY - d.startY)
        x = Math.max(4, Math.min(x, vw - d.w - 4))
        y = Math.max(4, Math.min(y, vh - d.h - 4))
        setPos(prev => prev ? Object.assign({}, prev, { x: Math.round(x), y: Math.round(y), vw, vh }) : prev)
      }
      const endDrag = (e) => {
        const d = dragRef.current
        if (!d) return
        if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0 }
        dragRef.current = null
        const wasPending = d.mode === 'pending'
        setGW(null)
        setGH(null)
        setDragging(false)
        if (d.doc && d.move && d.up) {
          d.doc.removeEventListener('mousemove', d.move)
          d.doc.removeEventListener('mouseup', d.up)
        }
        if (e.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function') {
          try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
        }
        hoverSuppress.current = false
        if (wasPending) {
          let inside = false
          if (rootRef.current) {
            const r = rootRef.current.getBoundingClientRect()
            inside = e.clientX >= r.left - 1 && e.clientX <= r.right + 1 &&
                     e.clientY >= r.top - 1 && e.clientY <= r.bottom + 1
          }
          if (!inside) closeIt()
          return
        }
        if (data && pos !== null && !open) {
          const mx = e.clientX
          const my = e.clientY
          openTRef.current = ctx.timeout(() => {
            openTRef.current = null
            openNow(mx, my)
          }, 90)
        }
      }
      const beginDrag = (e, isPointer) => {
        if (dragRef.current) return
        const target = e.target
        if (target && typeof target.closest === 'function' && target.closest('input, button, a, [data-no-drag]')) return
        cancelTimers()
        const view = e.view
        const vw = view && Number.isFinite(view.innerWidth) ? view.innerWidth : (pos ? pos.vw : e.clientX + 300)
        const vh = view && Number.isFinite(view.innerHeight) ? view.innerHeight : (pos ? pos.vh : e.clientY + 300)
        const wasOpen = open
        const rect = e.currentTarget.getBoundingClientRect()
        const cw = pos ? pos.w : rect.width
        const ch = pos ? pos.h : rect.height
        const d = {
          startX: e.clientX, startY: e.clientY,
          latestX: e.clientX, latestY: e.clientY,
          downAt: Date.now(),
          fromX: wasOpen ? 0 : (pos ? pos.x : rect.left),
          fromY: wasOpen ? 0 : (pos ? pos.y : rect.top),
          w: cw, h: ch, vw, vh, cw: cw, ch: ch,
          mode: wasOpen ? 'pending' : 'offset',
          raf: 0, cStart: 0, w0: cw, h0: ch, c0x: 0, c0y: 0,
          doc: null, move: null, up: null,
        }
        if (!wasOpen) {
          d.fromX = pos ? pos.x : rect.left
          d.fromY = pos ? pos.y : rect.top
          setDragging(true)
        }
        if (isPointer && typeof e.currentTarget.setPointerCapture === 'function') {
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
        } else {
          const doc = e.currentTarget.ownerDocument
          if (doc) {
            const move = (ev) => moveDrag(ev)
            const up = (ev) => endDrag(ev)
            d.doc = doc; d.move = move; d.up = up
            doc.addEventListener('mousemove', move)
            doc.addEventListener('mouseup', up)
          }
        }
        dragRef.current = d
        hoverSuppress.current = true
      }

      // ---- geometry: children order NEVER changes; direction flips via CSS ----
      let geom = {}
      if (pos === null) {
        geom = { right: '30%', bottom: 96 }
      } else {
        const useTarget = open && target !== null && !dragging
        if (foldUp) {
          geom = {
            left: useTarget ? target.x : pos.x,
            bottom: pos.vh - (pos.y + pos.h),
          }
        } else {
          geom = {
            left: useTarget ? target.x : pos.x,
            top: useTarget ? target.y : pos.y,
          }
        }
        if (!dragging) {
          geom.transition = 'width .24s cubic-bezier(.4,0,.2,1), left .24s cubic-bezier(.4,0,.2,1), top .24s cubic-bezier(.4,0,.2,1), bottom .24s cubic-bezier(.4,0,.2,1)'
        }
      }
      const style = Object.assign({}, blockStyle,
        { flexDirection: foldUp ? 'column-reverse' : 'column' },
        geom)
      if (gW != null) style.width = gW
      else if (wide) style.width = W
      else if (pos) style.width = pos.w
      if (gH != null) style.height = gH
      const sharedProps = {
        ref: rootRef, style,
        onMouseEnter: onEnter, onMouseLeave: onLeave,
        onPointerDown: (e) => beginDrag(e, true), onPointerMove: moveDrag,
        onPointerUp: endDrag, onPointerCancel: endDrag,
        onMouseDown: (e) => beginDrag(e, false), onMouseMove: moveDrag, onMouseUp: endDrag,
      }

      if (sid === undefined || !data) {
        const text = sid === undefined ? '用量浮窗 · 未打开会话' : '用量浮窗 · 载入中…'
        return React.createElement('div', sharedProps, text)
      }

      const summary = React.createElement('div', {
        ref: summaryRef,
        style: { display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', alignSelf: 'flex-start' },
      },
        React.createElement('span', { style: { fontWeight: 600 } }, '\uD83D\uDD25'),
        React.createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } },
          '¥' + fmtYuan(aYuan) + ' · ' + fmtK(aTotal) + ' tok · ' + Math.round(aCalls) + ' 次'),
      )

      function detailsInner() {
        const heading = React.createElement('div', { style: { fontWeight: 600, fontSize: 11, marginBottom: 6 } }, '本会话用量')
        const rowData = [
          ['总 token（输入+输出）', fmtInt(aTotal)],
          ['其中 输入/输出', fmtInt(aInput) + ' / ' + fmtInt(aOutput)],
          ['缓存命中（另计输入）', fmtInt(aCache)],
          ['思考 token（含在输出）', fmtInt(aReason)],
          ['模型调用次数', String(Math.round(aCalls))],
        ]
        const rows = rowData.map((pair, i) => React.createElement('div', { key: i, style: row },
          React.createElement('span', { style: { opacity: 0.7 } }, pair[0]),
          React.createElement('span', { style: { fontVariantNumeric: 'tabular-nums' } }, pair[1]),
        ))
        const money = React.createElement('div', { style: Object.assign({}, row, { marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.12)' }) },
          React.createElement('span', { style: { opacity: 0.7 } }, '估算费用'),
          React.createElement('span', { style: { fontWeight: 700, color: '#ffd479', fontVariantNumeric: 'tabular-nums' } }, '¥' + fmtYuan(aYuan)),
        )
        const warn = data.unpriced
          ? React.createElement('div', { style: { marginTop: 4, color: '#ffb4a8', fontSize: 10 } },
              '\u26A0 未计价模型: ' + data.unpricedModels.join(', ') + '（费用按 0 计，可在价格表里填）')
          : null
        const priceToggle = React.createElement('div', { style: { marginTop: 8, textAlign: 'right' } },
          React.createElement('span', {
            'data-no-drag': true,
            onClick: () => setShowRates(v => !v),
            style: { cursor: 'pointer', fontSize: 10, opacity: 0.7, textDecoration: 'underline' },
          }, showRates ? '关闭价格表' : '价格表(元/百万·空闲)'),
        )
        const children = [heading, rows, money]
        if (warn !== null) children.push(warn)
        children.push(priceToggle)
        if (showRates) {
          const setDraft = (model, field, raw) => {
            setDrafts(prev => {
              const next = Object.assign({}, prev)
              next[model] = Object.assign({}, prev[model] || {}, { [field]: raw })
              return next
            })
          }
          const commit = (model) => {
            const row = drafts[model] || {}
            void host.call('setRate', { model, miss: parseNum(row.miss), hit: parseNum(row.hit), out: parseNum(row.out) })
              .then(() => refresh(true)).catch(() => {})
          }
          const field = (model, key, current, label) => {
            const draftVal = drafts[model] ? drafts[model][key] : undefined
            return React.createElement('input', {
              type: 'number', step: 'any', min: '0', style: inputStyle, title: label,
              value: draftVal === undefined ? String(current) : draftVal,
              onChange: (e) => setDraft(model, key, e.target.value),
              onBlur: () => commit(model),
              onKeyDown: (e) => { if (e.key === 'Enter') commit(model) },
            })
          }
          const header = React.createElement('div', { style: Object.assign({}, row, { fontSize: 10, opacity: 0.7 }) },
            React.createElement('span', null, '模型'),
            React.createElement('span', null, '未命中/命中/输出'),
          )
          const body = (data.rates || []).map((rate) => {
            const name = rate.model === '__default__' ? '其他模型' : rate.model
            return React.createElement('div', { key: rate.model, style: Object.assign({}, row, { gap: 6, marginTop: 4 }) },
              React.createElement('span', { style: { fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 } }, name),
              React.createElement('span', { style: { display: 'flex', gap: 4 } },
                field(rate.model, 'miss', rate.miss, '输入未命中(缓存未命中) 元/百万 空闲'),
                field(rate.model, 'hit', rate.hit, '输入命中(缓存命中) 元/百万 空闲'),
                field(rate.model, 'out', rate.out, '输出 元/百万 空闲'),
              ),
            )
          })
          children.push(React.createElement('div', { style: { marginTop: 6, padding: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 8 } },
            header, body,
            React.createElement('div', { style: { marginTop: 4, fontSize: 9, opacity: 0.55 } },
              '高峰时段=空闲×2（北京 周一~五 9-12/14-18）。默认按 DeepSeek 官方价；改动仅本次运行有效。'),
          ))
        }
        return React.createElement('div', null, children)
      }
      const folder = React.createElement('div', {
        className: 'tf-folder' + (open ? ' tf-on' : ''),
        style: { alignSelf: 'stretch' },
      }, React.createElement('div', { className: 'tf-inner', ref: innerRef }, detailsInner()))
      const ruler = React.createElement('div', {
        ref: rulerRef,
        style: {
          position: 'fixed', left: -10000, top: 0, width: 294, visibility: 'hidden',
          pointerEvents: 'none',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: 12, lineHeight: 1.45, color: '#e8eaf2',
        },
      }, detailsInner())

      return React.createElement(React.Fragment, null,
        React.createElement('div', sharedProps, summary, folder),
        ruler)
    }

    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'tokf-usage-overlay', order: 60 },
      Overlay,
    ))
    slots.inject('conversation.session.header.utilities', () => slots.register(
      { name: 'conversation.session.header.utilities', id: 'tokf-usage-seat', order: 60 },
      SeatView,
    ))
  },
}
