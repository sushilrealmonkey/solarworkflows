import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { useAuth } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/ToastProvider";
import { Badge, Button, EmptyState, LoadingSkeleton, TextArea, TextInput } from "../crm/CrmComponents";
import { formatDate, labelize } from "../crm/crmUtils";
import { fetchFieldSurvey, fetchFieldSurveys, updateFieldSurveyStatus, updateFieldSurveyTechnical, uploadFieldSurveyEvidence } from "./siteSurveyApi";
import type { FieldSurvey } from "./types";

export function FieldSiteSurveysPage() {
  const [surveys, setSurveys] = useState<FieldSurvey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchFieldSurveys().then(setSurveys)
      .catch((value) => setError(value instanceof Error ? value.message : "Unable to load assigned surveys."))
      .finally(() => setLoading(false));
  }, []);
  return <div className="space-y-6">
    <PageHeader title="Site Surveys" description="Assigned survey work and your completed history." />
    {loading ? <LoadingSkeleton /> : null}
    {error ? <EmptyState title="Could not load surveys" description={error} /> : null}
    {!loading && !error && surveys.length === 0 ? <EmptyState title="No assigned surveys" description="New assignments will appear here." /> : null}
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{surveys.map((survey) =>
      <Link key={survey.id} to={`/site-surveys/${survey.id}`} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{survey.survey_code ?? "Survey"}</p><h2 className="mt-1 font-semibold text-slate-950">{survey.contact_name ?? "Site visit"}</h2></div><Badge tone="blue">{labelize(survey.survey_status)}</Badge></div>
        <p className="mt-3 text-sm text-slate-600">{formatDate(survey.scheduled_date)} {survey.scheduled_time ?? ""}</p>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{survey.site_address ?? "Address not available"}</p>
      </Link>)}</div>
  </div>;
}

type TechnicalForm = Record<"roof_type" | "roof_area_sqft" | "shadow_free_area_sqft" | "recommended_capacity_kw" | "sanctioned_load_kw" | "phase_type" | "latitude" | "longitude" | "address_notes" | "remarks", string>;

export function FieldSiteSurveyDetailPage() {
  const { id } = useParams();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [survey, setSurvey] = useState<FieldSurvey | null>(null);
  const [form, setForm] = useState<TechnicalForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    try {
      setLoading(true); setError(null);
      const next = await fetchFieldSurvey(id); setSurvey(next);
      if (next) setForm(toForm(next));
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to load survey."); }
    finally { setLoading(false); }
  }
  // Reload when the route identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [id]);
  const readOnly = survey?.survey_status === "completed" || survey?.survey_status === "cancelled";
  const nextStatus = survey?.survey_status === "scheduled" || survey?.survey_status === "rescheduled" ? "in_progress" : survey?.survey_status === "in_progress" ? "completed" : null;

  async function saveTechnical(event: FormEvent) {
    event.preventDefault(); if (!survey || !form || readOnly) return;
    try { setSaving(true); await updateFieldSurveyTechnical(survey.id, {
      roof_type: form.roof_type || null, roof_area_sqft: numberOrNull(form.roof_area_sqft), shadow_free_area_sqft: numberOrNull(form.shadow_free_area_sqft), recommended_capacity_kw: numberOrNull(form.recommended_capacity_kw), sanctioned_load_kw: numberOrNull(form.sanctioned_load_kw), phase_type: form.phase_type || null, latitude: numberOrNull(form.latitude), longitude: numberOrNull(form.longitude), address_notes: form.address_notes || null, remarks: form.remarks || null,
    }); showToast("Survey details updated.", "success"); await load(); }
    catch (value) { showToast(value instanceof Error ? value.message : "Survey update failed.", "error"); }
    finally { setSaving(false); }
  }
  async function updateStatus() {
    if (!survey || !nextStatus) return;
    try { setSaving(true); await updateFieldSurveyStatus(survey.id, nextStatus); showToast("Survey status updated.", "success"); await load(); }
    catch (value) { showToast(value instanceof Error ? value.message : "Status update failed.", "error"); }
    finally { setSaving(false); }
  }
  async function upload(file: File | undefined, kind: "photo" | "document") {
    if (!file || !survey) return;
    try { setSaving(true); await uploadFieldSurveyEvidence(profile, survey, file, kind); showToast("Survey evidence uploaded.", "success"); await load(); }
    catch (value) { showToast(value instanceof Error ? value.message : "Evidence upload failed.", "error"); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    <Link className="text-sm font-semibold text-[#06173f]" to="/site-surveys">Back to site surveys</Link>
    {loading ? <LoadingSkeleton /> : null}{error ? <EmptyState title="Could not load survey" description={error} /> : null}
    {!loading && !error && !survey ? <EmptyState title="Survey not found" description="This survey is not assigned to you." /> : null}
    {survey && form ? <>
      <header className="border-b border-stone-200 pb-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{survey.survey_code}</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">{survey.contact_name ?? "Site survey"}</h1><div className="mt-3"><Badge tone="blue">{labelize(survey.survey_status)}</Badge></div><p className="mt-3 text-sm text-slate-600">{survey.site_address}</p>{survey.contact_phone ? <a className="mt-2 inline-block font-semibold text-[#06173f]" href={`tel:${survey.contact_phone}`}>{survey.contact_phone}</a> : null}</header>
      <form className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm" onSubmit={saveTechnical}><h2 className="font-semibold text-slate-950">Technical survey</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><TextInput label="Roof type" value={form.roof_type} disabled={readOnly} onChange={(value) => setForm({ ...form, roof_type: value })}/><TextInput label="Roof area (sq ft)" type="number" value={form.roof_area_sqft} disabled={readOnly} onChange={(value) => setForm({ ...form, roof_area_sqft: value })}/><TextInput label="Shadow-free area (sq ft)" type="number" value={form.shadow_free_area_sqft} disabled={readOnly} onChange={(value) => setForm({ ...form, shadow_free_area_sqft: value })}/><TextInput label="Recommended capacity (kW)" type="number" value={form.recommended_capacity_kw} disabled={readOnly} onChange={(value) => setForm({ ...form, recommended_capacity_kw: value })}/><TextInput label="Sanctioned load (kW)" type="number" value={form.sanctioned_load_kw} disabled={readOnly} onChange={(value) => setForm({ ...form, sanctioned_load_kw: value })}/><TextInput label="Phase" value={form.phase_type} disabled={readOnly} onChange={(value) => setForm({ ...form, phase_type: value })}/><TextInput label="Latitude" type="number" value={form.latitude} disabled={readOnly} onChange={(value) => setForm({ ...form, latitude: value })}/><TextInput label="Longitude" type="number" value={form.longitude} disabled={readOnly} onChange={(value) => setForm({ ...form, longitude: value })}/><TextArea label="Address notes" value={form.address_notes} disabled={readOnly} onChange={(value) => setForm({ ...form, address_notes: value })}/><TextArea label="Survey remarks" value={form.remarks} disabled={readOnly} onChange={(value) => setForm({ ...form, remarks: value })}/></div>{!readOnly ? <div className="mt-4"><Button disabled={saving} type="submit">Save technical details</Button></div> : null}</form>
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Survey evidence</h2><p className="mt-1 text-sm text-slate-600">Photos and survey evidence for this assigned visit only.</p>{!readOnly ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="rounded-lg border border-dashed border-stone-300 p-4 text-sm font-semibold text-slate-700">Upload site photo<input className="mt-2 block w-full text-sm" type="file" accept="image/*" disabled={saving} onChange={(event) => void upload(event.target.files?.[0], "photo")}/></label><label className="rounded-lg border border-dashed border-stone-300 p-4 text-sm font-semibold text-slate-700">Upload survey document<input className="mt-2 block w-full text-sm" type="file" disabled={saving} onChange={(event) => void upload(event.target.files?.[0], "document")}/></label></div> : null}<p className="mt-4 text-sm text-slate-600">{survey.site_photos.length} photo(s) uploaded.</p></section>
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-950">Next Step</h2><div className="mt-4">{nextStatus ? <Button disabled={saving} onClick={updateStatus}>Update Status</Button> : <p className="text-sm text-slate-600">No status update is available. Completed work is read-only.</p>}</div></section>
    </> : null}
  </div>;
}

function toForm(survey: FieldSurvey): TechnicalForm { return { roof_type: survey.roof_type ?? "", roof_area_sqft: value(survey.roof_area_sqft), shadow_free_area_sqft: value(survey.shadow_free_area_sqft), recommended_capacity_kw: value(survey.recommended_capacity_kw), sanctioned_load_kw: value(survey.sanctioned_load_kw), phase_type: survey.phase_type ?? "", latitude: value(survey.latitude), longitude: value(survey.longitude), address_notes: survey.address_notes ?? "", remarks: survey.remarks ?? "" }; }
function value(input: number | null) { return input == null ? "" : String(input); }
function numberOrNull(input: string) { const parsed = Number(input); return input.trim() && Number.isFinite(parsed) ? parsed : null; }
