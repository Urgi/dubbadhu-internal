import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'

import supabase from '../lib/supabase'
import { uploadSeriesSpeakerPhoto } from '../lib/seriesListCover'
import { collectSeriesSpeakerNames, normalizeSpeakerPhotos } from '../lib/seriesSpeakers'
import { AdminSectionHeader } from './lesson-config/AdminLessonConfigChrome'
import SeriesListCoverCropModal from './SeriesListCoverCropModal'

const PHOTO_OUTPUT_PX = 512

type Props = {
  seriesId: string
  editable: boolean
  lessonSeriesRowExists: boolean
  /** Live-series warning; resolve false to cancel the save. */
  confirmSave: () => Promise<boolean>
}

function withVersion(publicUrl: string): string {
  const base = publicUrl.trim().split('#')[0].split('?')[0]
  return `${base}?v=${Date.now()}`
}

/**
 * Speaker headshots for this series. Names come from the series' dialogue screens
 * (person1 / person2) and saidBy fields, so nobody types them in.
 */
export default function SeriesSpeakerPhotosBlock({
  seriesId,
  editable,
  lessonSeriesRowExists,
  confirmSave,
}: Props) {
  const [names, setNames] = useState<string[]>([])
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [columnMissing, setColumnMissing] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [cropName, setCropName] = useState<string | null>(null)
  const [cropUri, setCropUri] = useState<string | null>(null)
  const [cropSession, setCropSession] = useState(0)

  const load = useCallback(async () => {
    const [{ data: lessons }, { data: seriesRow, error: seriesErr }] = await Promise.all([
      supabase.from('lessons').select('content,lesson_number').eq('series_id', seriesId),
      supabase.from('lesson_series').select('speaker_photos').eq('id', seriesId).maybeSingle(),
    ])
    const ordered = [...(lessons ?? [])].sort(
      (a, b) => (Number(a.lesson_number) || 1e9) - (Number(b.lesson_number) || 1e9),
    )
    setNames(collectSeriesSpeakerNames(ordered.map((l) => l.content)))
    if (seriesErr && /speaker_photos/i.test(seriesErr.message || '')) {
      setColumnMissing(true)
      return
    }
    setColumnMissing(false)
    setPhotos(normalizeSpeakerPhotos((seriesRow as { speaker_photos?: unknown } | null)?.speaker_photos))
  }, [seriesId])

  useEffect(() => {
    void load()
  }, [load])

  const savePhotos = useCallback(
    async (next: Record<string, string>, failTitle: string) => {
      const { error } = await supabase
        .from('lesson_series')
        .update({ speaker_photos: next })
        .eq('id', seriesId)
      if (error) {
        Alert.alert(failTitle, error.message)
        return false
      }
      setPhotos(next)
      return true
    },
    [seriesId],
  )

  const pick = useCallback(
    async (name: string) => {
      if (!lessonSeriesRowExists || !editable) return
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to choose a speaker photo.')
        return
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      })
      if (picked.canceled || !picked.assets?.[0]?.uri) return
      setCropSession((s) => s + 1)
      setCropName(name)
      setCropUri(picked.assets[0].uri)
    },
    [lessonSeriesRowExists, editable],
  )

  const onCropDone = useCallback(
    async (croppedUri: string) => {
      const name = cropName
      setCropName(null)
      setCropUri(null)
      if (!name) return
      if (!(await confirmSave())) return
      setBusyName(name)
      const up = await uploadSeriesSpeakerPhoto(croppedUri, seriesId, name)
      if ('error' in up) {
        setBusyName(null)
        Alert.alert('Could not upload photo', up.error)
        return
      }
      await savePhotos({ ...photos, [name]: withVersion(up.publicUrl) }, 'Could not save photo')
      setBusyName(null)
    },
    [cropName, confirmSave, seriesId, photos, savePhotos],
  )

  const clear = useCallback(
    async (name: string) => {
      if (!editable) return
      if (!(await confirmSave())) return
      setBusyName(name)
      const next = { ...photos }
      delete next[name]
      await savePhotos(next, 'Could not clear photo')
      setBusyName(null)
    },
    [editable, confirmSave, photos, savePhotos],
  )

  return (
    <View>
      <AdminSectionHeader label="Speaker photos" emphasis="gold" />
      <Text style={styles.hint}>
        Shown as the native speaker's picture on Speak lesson screens. Names come from this series'
        dialogues. Empty keeps the person icon.
      </Text>
      {columnMissing ? (
        <Text style={styles.warn}>
          Apply the speaker_photos migration on this Supabase project, then reopen this series.
        </Text>
      ) : names.length === 0 ? (
        <Text style={styles.hint}>No speakers found yet. Add a dialogue screen with names first.</Text>
      ) : (
        names.map((name) => {
          const url = photos[name]
          const busy = busyName === name
          return (
            <View key={name} style={styles.row}>
              {url ? (
                <Image source={{ uri: url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarEmpty]}>
                  <Text style={styles.initial}>{name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              <Pressable
                style={[styles.btn, (!editable || busy) && styles.btnDisabled]}
                onPress={() => void pick(name)}
                disabled={!editable || busy}
              >
                <Text style={styles.btnText}>{busy ? 'Working…' : url ? 'Replace' : 'Add photo'}</Text>
              </Pressable>
              {url ? (
                <Pressable
                  style={[styles.btn, (!editable || busy) && styles.btnDisabled]}
                  onPress={() => void clear(name)}
                  disabled={!editable || busy}
                >
                  <Text style={styles.btnText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
          )
        })
      )}
      <SeriesListCoverCropModal
        key={`speaker-photo-crop-${cropSession}`}
        visible={!!cropUri}
        imageUri={cropUri}
        variant="speak"
        aspectWidth={1}
        aspectHeight={1}
        outputWidth={PHOTO_OUTPUT_PX}
        outputHeight={PHOTO_OUTPUT_PX}
        onCancel={() => {
          setCropName(null)
          setCropUri(null)
        }}
        onDone={onCropDone}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, color: '#636366', lineHeight: 16, marginBottom: 8 },
  warn: { fontSize: 12, color: '#fbbf24', lineHeight: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarEmpty: {
    backgroundColor: '#1c1c1e',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#52525b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: '#a1a1aa', fontSize: 18, fontWeight: '700' },
  name: { flex: 1, color: '#e4e4e7', fontSize: 15, fontWeight: '600' },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#52525b',
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#a1a1aa', fontSize: 13, fontWeight: '600' },
})
