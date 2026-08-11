import { ResourceList } from "@/components/ResourceList";
import { useEffect, useState } from "react";
import { FieldWorkList } from "@/components/FieldWorkList";
import { mobileApi } from "@/lib/api";
export default function ProjectsScreen() { const [field, setField] = useState<boolean | null>(null); useEffect(() => { void mobileApi.session().then((context) => setField(context.roles.includes("Field Staff"))).catch(() => setField(false)); }, []); if (field === null) return null; return field ? <FieldWorkList resource="projects" title="Projects" /> : <ResourceList resource="projects" title="Projects" showCreate />; }
