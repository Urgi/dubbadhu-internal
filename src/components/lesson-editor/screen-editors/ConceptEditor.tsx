/** Lesson editor form for `concept` screens (moved from LessonScreenEditModal.tsx). */
import { type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { AdminTextInput } from '../../AdminTextInput'
import {
  Field,
  styles,
} from '../lessonEditorShared'
import type { ScreenEditorContext } from './screenEditorContext'

export function renderConceptEditor(ctx: ScreenEditorContext): ReactNode {
  const { allowJsonEditing, c, draftRef, primaryScreenSaveRef, saveStructured, setContent, setJsonError } = ctx
  const hasLegacySections = Array.isArray(c.sections)
  const rawBullets = Array.isArray(c.bullets) ? (c.bullets as string[]) : ['']
  const bullets = rawBullets.slice(0, 3)
  const setBullets = (next: string[]) => {
    setContent((cur) => ({ ...cur, bullets: next.slice(0, 3) }))
  }

  const moveBullet = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= bullets.length) return
    const next = [...bullets]
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setBullets(next)
  }

  const removeBullet = (idx: number) => {
    if (bullets.length <= 1) return
    setBullets(bullets.filter((_, i) => i !== idx))
  }

  const addBullet = () => {
    if (bullets.length >= 3) return
    setBullets([...bullets, ''])
  }

  const convertLegacySectionsToCanonical = () => {
    const heading =
      (typeof c.heading === 'string' && c.heading.trim()) ||
      (typeof c.title === 'string' && c.title.trim()) ||
      'Concept'
    const sections = Array.isArray(c.sections) ? (c.sections as Record<string, unknown>[]) : []
    const converted = sections
      .map((s) => {
        const t = typeof s.title === 'string' ? s.title : ''
        const body =
          typeof s.content === 'string' ? s.content : typeof s.text === 'string' ? s.text : ''
        const both = [t, body].filter(Boolean).join(' — ')
        return both.trim()
      })
      .filter(Boolean)
    setContent(() => ({
      targetWord: heading,
      bullets: converted.length ? converted.slice(0, 3) : [''],
    }))
  }

  primaryScreenSaveRef.current = () => {
    const d = draftRef.current
    if (!d) return
    const co = d.content as Record<string, unknown>
    const rb = Array.isArray(co.bullets) ? (co.bullets as string[]) : ['']
    const cleaned = rb.slice(0, 3).map((x) => String(x ?? '').trim()).filter(Boolean)
    const tw = String(co.targetWord ?? '').trim()
    if (!tw) {
      setJsonError('Concept needs a target word.')
      return
    }
    if (cleaned.length < 1) {
      setJsonError('Concept needs at least one non-empty bullet.')
      return
    }
    setJsonError('')
    saveStructured({ targetWord: tw, bullets: cleaned.slice(0, 3) })
  }

  return (
    <View style={styles.form}>
      {hasLegacySections ? (
        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>This concept still has legacy `sections[]` in JSON</Text>
          <Text style={styles.warningBody}>
            The learner expects `targetWord` and `bullets` only. Convert here, or clean the row in Supabase / raw
            JSON.
            {allowJsonEditing ? ' Raw JSON is available below if needed.' : ''}
          </Text>
          <Pressable style={styles.convertBtn} onPress={convertLegacySectionsToCanonical}>
            <Text style={styles.convertBtnText}>Convert to target word + bullets</Text>
          </Pressable>
        </View>
      ) : null}

      <Field
        label="Target word"
        value={String(c.targetWord ?? '')}
        onChangeText={(t) =>
          setContent((cur) => ({
            ...cur,
            targetWord: t,
            bullets: (Array.isArray(cur.bullets) ? (cur.bullets as string[]) : ['']).slice(0, 3),
          }))
        }
      />
      <Text style={styles.hint}>
        Learner shows an animated reveal for the target word and up to three bullets. Persist only these fields.
      </Text>

      <Text style={styles.label}>Bullets (max 3)</Text>
      {bullets.map((b, i) => (
        <View key={i} style={styles.bulletRow}>
          <AdminTextInput
            style={styles.bulletInput}
            value={String(b ?? '')}
            onChangeText={(t) => {
              const next = bullets.map((x, j) => (j === i ? t : x))
              setBullets(next)
            }}
            placeholder={`Bullet ${i + 1}`}
            placeholderTextColor="#52525b"
          />
          <Pressable
            style={styles.bulletMiniBtn}
            onPress={() => moveBullet(i, -1)}
            disabled={i === 0}
          >
            <Text style={[styles.bulletMiniBtnText, i === 0 && styles.bulletMiniDisabled]}>↑</Text>
          </Pressable>
          <Pressable
            style={styles.bulletMiniBtn}
            onPress={() => moveBullet(i, 1)}
            disabled={i === bullets.length - 1}
          >
            <Text
              style={[
                styles.bulletMiniBtnText,
                i === bullets.length - 1 && styles.bulletMiniDisabled,
              ]}
            >
              ↓
            </Text>
          </Pressable>
          <Pressable
            style={styles.bulletMiniBtn}
            onPress={() => removeBullet(i)}
            disabled={bullets.length <= 1}
          >
            <Text
              style={[
                styles.bulletMiniBtnTextDanger,
                bullets.length <= 1 && styles.bulletMiniDisabled,
              ]}
            >
              ✕
            </Text>
          </Pressable>
        </View>
      ))}
      <Pressable style={styles.addBtn} onPress={addBullet} disabled={bullets.length >= 3}>
        <Text style={[styles.addBtnText, bullets.length >= 3 && styles.bulletMiniDisabled]}>+ Add bullet</Text>
      </Pressable>
    </View>
  )
}
