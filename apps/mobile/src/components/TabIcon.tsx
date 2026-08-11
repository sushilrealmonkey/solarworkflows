import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

const glyphs = { home: "⌂", dashboard: "▥", projects: "▤", inventory: "▦" } as const;

export function TabIcon({ name, focused }: { name: keyof typeof glyphs; focused: boolean }) {
  return <View style={styles.box}><Text style={[styles.icon, focused && styles.active]}>{glyphs[name]}</Text></View>;
}

const styles = StyleSheet.create({ box: { width: 26, height: 25, alignItems: "center", justifyContent: "center" }, icon: { color: colors.muted, fontSize: 25, lineHeight: 27, fontWeight: "800" }, active: { color: colors.orange } });
