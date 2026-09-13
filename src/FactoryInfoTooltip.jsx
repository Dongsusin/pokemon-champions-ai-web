import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './factoryInfoTooltip.css'

export default function FactoryInfoTooltip({ children, title, description, meta, focusable = true }) {
  const id = useId()
  const anchor = useRef(null)
  const tooltip = useRef(null)
  const timer = useRef(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const cancelClose = () => window.clearTimeout(timer.current)
  const show = () => { cancelClose(); setOpen(true) }
  const hide = () => { cancelClose(); setOpen(false); setPosition(null) }
  const scheduleClose = () => { cancelClose(); timer.current = window.setTimeout(hide, 120) }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tooltip.current) return
    const target = anchor.current.getBoundingClientRect()
    const box = tooltip.current.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const above = target.top >= box.height + gap + margin
    const clamp = (value, max) => Math.max(margin, Math.min(value, max))
    setPosition({
      left: clamp(target.left + (target.width - box.width) / 2, window.innerWidth - box.width - margin),
      top: clamp(above ? target.top - box.height - gap : target.bottom + gap, window.innerHeight - box.height - margin),
    })
  }, [open, title, description, meta])

  useEffect(() => {
    if (!open) return
    const dismissOutside = event => {
      if (!anchor.current?.contains(event.target) && !tooltip.current?.contains(event.target)) hide()
    }
    const dismissScroll = event => { if (!tooltip.current?.contains(event.target)) hide() }
    const dismissEscape = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      hide()
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('keydown', dismissEscape, true)
    window.addEventListener('scroll', dismissScroll, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('keydown', dismissEscape, true)
      window.removeEventListener('scroll', dismissScroll, true)
      window.removeEventListener('resize', hide)
    }
  }, [open])

  if (!description) return children

  return <>{cloneElement(children, {
    ref: anchor,
    className: `${children.props.className ?? ''} factory-tooltip-anchor`,
    tabIndex: focusable ? 0 : undefined,
    'aria-describedby': open ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: scheduleClose,
    onFocus: show,
    onBlur: hide,
    onClick: event => { event.stopPropagation(); show() },
  })}
    {/* Modal tooltips must stay inside the native dialog's top layer. */}
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" className="factory-info-tooltip"
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
      onClick={event => event.stopPropagation()}>
      <strong className="factory-info-tooltip-title">{title}</strong>
      <p className="factory-info-tooltip-description">{description}</p>
      {meta && <p className="factory-info-tooltip-meta">{meta}</p>}
    </div>, anchor.current?.closest('dialog') ?? document.body)}
  </>
}
