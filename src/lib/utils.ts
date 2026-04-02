import { clsx, type ClassValue } from 'clsx'
import { createContext, useContext } from 'react'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function createSafeContext<T>(name: string) {
  const Ctx = createContext<T | null>(null)
  Ctx.displayName = name
  const useSafeContext = () => {
    const value = useContext(Ctx)
    if (!value) throw new Error(`${name} context is missing a Provider`)
    return value
  }
  return [Ctx.Provider, useSafeContext] as const
}
