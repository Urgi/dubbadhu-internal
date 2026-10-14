import * as FileSystem from 'expo-file-system/legacy'
import {
  MRR_BURN_STORAGE_KEY,
  defaultMrrBurnState,
  mergeMrrBurnState,
  type MrrBurnState,
} from './mrrBurn'

function storagePath(): string | null {
  if (!FileSystem.documentDirectory) return null
  return `${FileSystem.documentDirectory}${MRR_BURN_STORAGE_KEY}.json`
}

export async function loadMrrBurnState(): Promise<MrrBurnState> {
  const path = storagePath()
  if (!path) return defaultMrrBurnState()
  try {
    const info = await FileSystem.getInfoAsync(path)
    if (!info.exists) return defaultMrrBurnState()
    const raw = await FileSystem.readAsStringAsync(path)
    return mergeMrrBurnState(JSON.parse(raw) as Partial<MrrBurnState>)
  } catch {
    return defaultMrrBurnState()
  }
}

export async function saveMrrBurnState(state: MrrBurnState): Promise<void> {
  const path = storagePath()
  if (!path) return
  await FileSystem.writeAsStringAsync(path, JSON.stringify(state))
}
