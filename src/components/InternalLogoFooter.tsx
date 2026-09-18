import { Image, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** Canonical Dubbadhu mark (same illustration as dubbadhu-site / app icon). */
const LOGO = require('../../assets/dubbadhu-logo.png')

/**
 * Watermark footer for leftover space under a short settings/hub list.
 * Use as the last child of a ScrollView with `flexGrow: 1` content so it
 * sits in unused bottom area, or scrolls as a non-blocking footer when the
 * list is long.
 */
export default function InternalLogoFooter() {
  const insets = useSafeAreaInsets()
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no"
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 16) }]}
    >
      <Image source={LOGO} style={styles.logo} resizeMode="contain" />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 'auto',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 32,
  },
  logo: {
    width: 96,
    height: 96,
    opacity: 0.2,
  },
})
