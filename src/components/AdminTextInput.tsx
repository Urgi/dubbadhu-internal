import { forwardRef } from 'react'
import { Keyboard, TextInput, type TextInputProps } from 'react-native'

export type AdminTextInputProps = TextInputProps & {
  /**
   * When true, Return adds a new line (JSON, scripts, paste-many-lines, team notes).
   * When false (default), keyboard shows Done and dismisses on submit.
   */
  allowMultiline?: boolean
}

/** Number pads have no Return key — setting returnKeyType "done" leaves a lone Done bar (esp. with hardware keyboard). */
function isNumberPadKeyboard(
  keyboardType: TextInputProps['keyboardType'] | undefined,
): boolean {
  return (
    keyboardType === 'number-pad' ||
    keyboardType === 'decimal-pad' ||
    keyboardType === 'phone-pad' ||
    keyboardType === 'numeric'
  )
}

/**
 * Standard admin text field: Done key dismisses keyboard unless `allowMultiline` is set.
 */
export const AdminTextInput = forwardRef<TextInput, AdminTextInputProps>(function AdminTextInput(
  {
    allowMultiline = false,
    multiline,
    onSubmitEditing,
    returnKeyType,
    blurOnSubmit,
    keyboardType,
    ...rest
  },
  ref,
) {
  const multilineEnabled = allowMultiline || multiline === true
  const dismissOnSubmit = !allowMultiline
  const numberPad = isNumberPadKeyboard(keyboardType)

  return (
    <TextInput
      ref={ref}
      {...rest}
      keyboardType={keyboardType}
      multiline={multilineEnabled}
      returnKeyType={
        numberPad
          ? returnKeyType
          : dismissOnSubmit
            ? (returnKeyType ?? 'done')
            : (returnKeyType ?? 'default')
      }
      blurOnSubmit={
        numberPad
          ? (blurOnSubmit ?? false)
          : dismissOnSubmit
            ? (blurOnSubmit ?? true)
            : (blurOnSubmit ?? false)
      }
      onSubmitEditing={(e) => {
        onSubmitEditing?.(e)
        if (dismissOnSubmit && !numberPad) Keyboard.dismiss()
      }}
    />
  )
})
