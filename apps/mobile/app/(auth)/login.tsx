import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { normalizeIndianPhone } from "@bizlee/domain";
export default function LoginScreen() {
  const [method, setMethod] = useState<"phone" | "email">("phone"); const [mode, setMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState(""); const [password, setPassword] = useState(""); const [otp, setOtp] = useState(""); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [errorMessage, setErrorMessage] = useState<string | null>(null);
  async function submit() {
    setErrorMessage(null);
    if (!identifier.trim()) { setErrorMessage(method === "email" ? "Enter your email address." : "Enter your mobile number."); return; }
    if (method === "email" && !password) { setErrorMessage("Enter your password."); return; }
    setBusy(true); try {
      if (method === "email") {
        const email = identifier.trim().toLowerCase();
        const request = mode === "signup" ? supabase.auth.signUp({ email, password, options: { emailRedirectTo: "bizlee://auth/callback" } }) : supabase.auth.signInWithPassword({ email, password });
        const result = await withTimeout(request, "Sign in took too long. Check your connection and try again.");
        if (result.error) throw result.error; if (mode === "signup" && !result.data.session) Alert.alert("Check your email", "Open the verification link to continue.");
      } else {
        const phone = normalizeIndianPhone(identifier); const result = sent ? await supabase.auth.verifyOtp({ phone, token: otp, type: "sms" }) : await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: mode === "signup" } });
        if (result.error) throw result.error; if (!sent) setSent(true);
      }
    } catch (error) { const message = error instanceof Error ? error.message : "Try again"; setErrorMessage(message); Alert.alert(mode === "signup" ? "Unable to sign up" : "Unable to sign in", message); } finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.body}><Text style={styles.brand}>BIZLEE</Text><Text style={styles.title}>Your solar business, in your pocket.</Text><View style={styles.switch}><Pressable onPress={() => { setMethod("phone"); setSent(false); setErrorMessage(null); }} style={[styles.switchButton, method === "phone" && styles.active]}><Text>Mobile & WhatsApp</Text></Pressable><Pressable onPress={() => { setMethod("email"); setErrorMessage(null); }} style={[styles.switchButton, method === "email" && styles.active]}><Text>Email</Text></Pressable></View><TextInput accessibilityLabel={method === "phone" ? "Mobile number" : "Email"} autoCapitalize="none" keyboardType={method === "phone" ? "phone-pad" : "email-address"} onChangeText={setIdentifier} placeholder={method === "phone" ? "98765 43210" : "you@company.com"} style={styles.input} value={identifier} />{method === "email" && <TextInput accessibilityLabel="Password" autoCapitalize="none" onChangeText={setPassword} placeholder="Password" secureTextEntry style={styles.input} value={password} />}{method === "phone" && sent && <TextInput accessibilityLabel="One-time password" keyboardType="number-pad" maxLength={8} onChangeText={setOtp} placeholder="Verification code" style={styles.input} value={otp} />}{errorMessage ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage}</Text> : null}<Pressable disabled={busy} onPress={submit} style={[styles.primary, busy && styles.disabled]}><Text style={styles.primaryText}>{busy ? "Please wait..." : method === "phone" && !sent ? "Send code" : mode === "signup" ? "Create account" : "Sign in"}</Text></Pressable><Pressable onPress={() => { setMode(mode === "login" ? "signup" : "login"); setSent(false); setErrorMessage(null); }}><Text style={styles.note}>{mode === "login" ? "New to Bizlee? Create an account" : "Already have an account? Sign in"}</Text></Pressable></KeyboardAvoidingView></SafeAreaView>;
}
function withTimeout<T>(request: PromiseLike<T>, message: string): Promise<T> {
  return Promise.race([Promise.resolve(request), new Promise<T>((_resolve, reject) => { setTimeout(() => reject(new Error(message)), 20_000); })]);
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#06173f" }, body: { flex: 1, justifyContent: "center", padding: 24, gap: 14 }, brand: { color: "#fb923c", fontSize: 18, fontWeight: "900", letterSpacing: 2 }, title: { color: "white", fontSize: 32, fontWeight: "800", marginBottom: 12 }, switch: { flexDirection: "row", backgroundColor: "#ffffff18", borderRadius: 12, padding: 4 }, switchButton: { flex: 1, padding: 12, alignItems: "center", borderRadius: 9 }, active: { backgroundColor: "white" }, input: { backgroundColor: "white", borderRadius: 12, padding: 16, fontSize: 16 }, error: { color: "#fecaca", backgroundColor: "#ef444422", borderColor: "#f8717180", borderWidth: 1, borderRadius: 10, padding: 11, lineHeight: 19 }, primary: { backgroundColor: "#f97316", padding: 16, alignItems: "center", borderRadius: 12 }, disabled: { opacity: 0.65 }, primaryText: { color: "white", fontWeight: "800", fontSize: 16 }, note: { color: "#fdba74", textAlign: "center", lineHeight: 20 } });
