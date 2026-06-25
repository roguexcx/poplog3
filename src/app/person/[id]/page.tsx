import { uiMessage } from "@/lib/i18n/ui-message";
import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPersonPageData } from "@/server/poplog-people/getPersonPageData";
import PersonPageClient from "./PersonPageClient";
type Props = {
    params: Promise<{
        id: string;
    }>;
};
function fetchPersonData(id: string) {
    // Camada única com cache persistente local; a segunda chamada no mesmo
    // request (generateMetadata + página) resolve via cache fresh do banco.
    return getPersonPageData({ id, language: "pt-BR", region: "BR" });
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    const { person } = await fetchPersonData(id);
    const name = person?.name ?? "Pessoa";
    const description = person?.biography
        ? person.biography.slice(0, 155) + (person.biography.length > 155 ? "..." : "")
        : uiMessage("ui.c985aaa5c211", { v1: name });
    return {
        title: name,
        description,
    };
}
export default async function PersonPage({ params }: Props) {
    const { id } = await params;
    const data = await fetchPersonData(id);
    if (!data.person)
        notFound();
    return (<PersonPageClient person={data.person} acting={data.acting} directing={data.directing} writing={data.writing} producing={data.producing} otherCrew={data.otherCrew}/>);
}

