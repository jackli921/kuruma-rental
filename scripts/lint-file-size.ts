#!/usr/bin/env bun
import { readFileSync } from 'node:fs'

const HARD_FAIL = 800
const SOFT_WARN = 400

export type Issue = {
  file: string
  lines: number
  cap: number
  level: 'warn' | 'error'
}

export function checkFiles(files: string[]): Issue[] {
  const issues: Issue[] = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    // Use trimEnd to match `wc -l` semantics: trailing newline doesn't count as an extra line.
    const lines = content.trimEnd().split('\n').length
    if (lines > HARD_FAIL) {
      issues.push({ file, lines, cap: HARD_FAIL, level: 'error' })
    } else if (lines > SOFT_WARN) {
      issues.push({ file, lines, cap: SOFT_WARN, level: 'warn' })
    }
  }
  return issues
}
