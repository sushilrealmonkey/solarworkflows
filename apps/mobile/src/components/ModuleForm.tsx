import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { clearDraft, loadDraft, saveDraft } from "@/lib/query";
import { mobileApi } from "@/lib/api";
import type { FormField, ModuleConfig } from "@/modules/moduleConfig";
import { colors } from "@/theme";

type Values = Record<string, string>;

function validateField(config: ModuleConfig, field: FormField, value: string) {
  const normalizedValue = value.trim();

  if (config.resource === "enquiries" && field.kind === "phone") {
    return /^\d{10}$/.test(normalizedValue)
      ? true
      : `${field.label} must contain exactly 10 digits`;
  }

  if (
    field.kind === "email" &&
    normalizedValue &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)
  ) {
    return "Enter a valid email address";
  }

  return true;
}

export function ModuleForm({ config }: { config: ModuleConfig }) {
  const form = useForm<Values>({
    defaultValues: Object.fromEntries(
      config.fields.map((field) => [field.key, ""]),
    ),
  });
  const router = useRouter();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<{
    userId: string;
    companyId: string;
  } | null>(null);
  const draftKey = `form-${config.resource}`;

  useEffect(() => {
    void mobileApi.session().then(async (context) => {
      const next = {
        userId: context.user.id,
        companyId: context.tenant.companyId,
      };
      setScope(next);
      const draft = await loadDraft<Values>(
        next.userId,
        next.companyId,
        draftKey,
      );
      if (draft) form.reset(draft);
    });
  }, [draftKey, form]);

  useEffect(() => {
    if (!scope) return;
    const subscription = form.watch((value) => {
      void saveDraft(scope.userId, scope.companyId, draftKey, value);
    });
    return () => subscription.unsubscribe();
  }, [draftKey, form, scope]);

  const create = useMutation({
    mutationFn: (values: Values) =>
      mobileApi.createRecord(
        config.resource as "customers" | "enquiries",
        {
          fullName: values.fullName ?? "",
          phone: values.phone ?? "",
          email: values.email,
          city: values.city,
          address: values.address,
          leadSource: values.leadSource,
          requirementType: values.requirementType,
          customerType: values.customerType,
          notes: values.notes,
        },
      ),
    onSuccess: async () => {
      if (scope) {
        await clearDraft(scope.userId, scope.companyId, draftKey);
      }
      await queryClient.invalidateQueries({ queryKey: [config.resource] });
      router.back();
    },
    onError: (error) =>
      Alert.alert(
        `Could not create ${config.singular}`,
        error instanceof Error ? error.message : "Try again",
      ),
  });

  const submit = form.handleSubmit((values) =>
    config.createEnabled
      ? create.mutate(values)
      : Alert.alert(
          "Draft saved",
          `The ${config.singular} form is ready. Submission will be enabled when this module's workflow is configured.`,
        ),
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.page}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>
          NEW {config.singular.toUpperCase()}
        </Text>
        <Text style={styles.title}>The essentials first</Text>
        <Text style={styles.copy}>
          {config.description} Your draft is saved on this device.
        </Text>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          {config.fields.map((field) => (
            <Controller
              key={field.key}
              control={form.control}
              name={field.key}
              rules={{
                required: field.required
                  ? `${field.label} is required`
                  : false,
                validate: (value) => validateField(config, field, value),
              }}
              render={({ field: input, fieldState }) => (
                <View style={styles.field}>
                  <Text style={styles.label}>
                    {field.label}
                    {field.required ? (
                      <Text style={styles.required}> *</Text>
                    ) : null}
                  </Text>
                  <TextInput
                    accessibilityLabel={field.label}
                    autoCapitalize={
                      field.kind === "email" ? "none" : "sentences"
                    }
                    autoCorrect={field.kind !== "email"}
                    keyboardType={
                      field.kind === "phone"
                        ? "phone-pad"
                        : field.kind === "email"
                          ? "email-address"
                          : field.kind === "number"
                            ? "decimal-pad"
                            : "default"
                    }
                    maxLength={
                      config.resource === "enquiries" &&
                      field.kind === "phone"
                        ? 10
                        : undefined
                    }
                    multiline={field.kind === "multiline"}
                    onBlur={input.onBlur}
                    onChangeText={input.onChange}
                    placeholder={
                      field.kind === "date"
                        ? "DD / MM / YYYY"
                        : `Enter ${field.label.toLowerCase()}`
                    }
                    placeholderTextColor="#94a3b8"
                    style={[
                      styles.input,
                      field.kind === "multiline" && styles.multiline,
                      fieldState.error && styles.inputError,
                    ]}
                    value={input.value}
                  />
                  {fieldState.error ? (
                    <Text style={styles.error}>{fieldState.error.message}</Text>
                  ) : null}
                </View>
              )}
            />
          ))}
        </View>
        <Pressable
          disabled={create.isPending}
          onPress={submit}
          style={styles.submit}
        >
          <Text style={styles.submitText}>
            {create.isPending
              ? "Saving…"
              : config.createEnabled
                ? `Create ${config.singular}`
                : "Save draft"}
          </Text>
        </Pressable>
        {!config.createEnabled ? (
          <Text style={styles.notice}>Draft only · no business workflow will run</Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 48 },
  eyebrow: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  title: { color: colors.navy, fontSize: 28, fontWeight: "900", marginTop: 5 },
  copy: {
    color: colors.muted,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 22,
  },
  section: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
  },
  sectionTitle: {
    color: colors.navy,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 16,
  },
  field: { marginBottom: 15 },
  label: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 7,
  },
  required: { color: colors.orange },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    paddingHorizontal: 13,
    color: colors.ink,
    fontSize: 16,
    backgroundColor: "#fbfdff",
  },
  multiline: { minHeight: 96, paddingTop: 13, textAlignVertical: "top" },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 12, marginTop: 5 },
  submit: {
    backgroundColor: colors.navy,
    minHeight: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  submitText: { color: "white", fontSize: 16, fontWeight: "900" },
  notice: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 10 },
});
