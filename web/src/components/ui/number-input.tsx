import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { type InputHTMLAttributes } from "react"

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: number | string | null | undefined
  onValueChange: (value: number | null) => void
}

/**
 * Number input that avoids the "010" leading-zero issue.
 * Uses internal string state so users can freely type/delete.
 * Syncs parsed number to parent on every valid change.
 */
export function NumberInput({ value, onValueChange, className, ...props }: NumberInputProps) {
  // Internal string state — allows empty field, partial input, etc.
  const [text, setText] = useState(() =>
    value != null && value !== "" ? String(value) : ""
  )

  // Sync from parent when value changes externally (e.g. preset load)
  useEffect(() => {
    const external = value != null && value !== "" ? String(value) : ""
    // Only sync if the numeric value actually differs (avoid cursor jumping)
    const currentNum = text === "" ? null : Number(text)
    const externalNum = external === "" ? null : Number(external)
    if (currentNum !== externalNum) {
      setText(external)
    }
  }, [value])

  return (
    <Input
      type="text"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        // Allow empty
        if (raw === "") {
          setText("")
          onValueChange(null)
          return
        }
        // Allow only digits and decimal point
        if (!/^[0-9]*\.?[0-9]*$/.test(raw)) return
        setText(raw)
        const num = Number(raw)
        if (!isNaN(num)) {
          onValueChange(num)
        }
      }}
      className={cn("tabular-nums", className)}
      {...props}
    />
  )
}
