import { useCallback, useEffect, useRef, useState } from "react"

export interface HeartSample {
  /** Ride seconds when the sample arrived. */
  time: number
  bpm: number
}

interface BluetoothCharacteristicLike extends EventTarget {
  value?: DataView
  startNotifications(): Promise<unknown>
}

interface BluetoothDeviceLike extends EventTarget {
  name?: string
  gatt?: {
    connected: boolean
    connect(): Promise<{
      getPrimaryService(service: number | string): Promise<{
        getCharacteristic(characteristic: number | string): Promise<BluetoothCharacteristicLike>
      }>
    }>
    disconnect(): void
  }
}

interface BluetoothLike {
  requestDevice(options: { filters: { services: (number | string)[] }[] }): Promise<BluetoothDeviceLike>
}

export type HeartSupport = "supported" | "ios" | "unsupported" | "insecure"

export function heartRateSupport(): HeartSupport {
  if (typeof navigator === "undefined") return "unsupported"
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)) return "ios"
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure"
  return "bluetooth" in navigator ? "supported" : "unsupported"
}

/** Heart Rate Measurement (0x2A37): flags byte, then uint8 or uint16 bpm. */
export function parseHeartRate(view: DataView): number {
  const flags = view.getUint8(0)
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1)
}

/** Live heart rate over Web Bluetooth (Heart Rate service 0x180D). */
export function useHeartRate(clock: () => number) {
  const [bpm, setBpm] = useState<number | null>(null)
  const [samples, setSamples] = useState<HeartSample[]>([])
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const device = useRef<BluetoothDeviceLike | null>(null)
  const clockRef = useRef(clock)
  useEffect(() => {
    clockRef.current = clock
  }, [clock])

  const connect = useCallback(async () => {
    const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothLike }).bluetooth
    if (!bluetooth) {
      setStatus("error")
      setMessage("This browser has no Web Bluetooth. Use Chrome on desktop or Android.")
      return
    }
    try {
      setStatus("connecting")
      setMessage(null)
      const picked = await bluetooth.requestDevice({ filters: [{ services: [0x180d] }] })
      device.current = picked
      setDeviceName(picked.name ?? "Heart-rate strap")
      picked.addEventListener("gattserverdisconnected", () => {
        setStatus("idle")
        setMessage("Heart-rate sensor disconnected.")
      })
      const server = await picked.gatt!.connect()
      const service = await server.getPrimaryService(0x180d)
      const characteristic = await service.getCharacteristic(0x2a37)
      characteristic.addEventListener("characteristicvaluechanged", () => {
        if (!characteristic.value) return
        const value = parseHeartRate(characteristic.value)
        if (value < 25 || value > 250) return
        setBpm(value)
        setSamples((list) => {
          const next = [...list, { time: clockRef.current(), bpm: value }]
          return next.length > 20000 ? next.slice(-20000) : next
        })
      })
      await characteristic.startNotifications()
      setStatus("connected")
    } catch (error) {
      setStatus("error")
      setMessage(error instanceof Error ? error.message : "Couldn't connect to the sensor.")
    }
  }, [])

  const disconnect = useCallback(() => {
    device.current?.gatt?.disconnect()
    device.current = null
    setStatus("idle")
  }, [])

  const reset = useCallback(() => setSamples([]), [])

  return { bpm, samples, status, message, deviceName, connect, disconnect, reset }
}
