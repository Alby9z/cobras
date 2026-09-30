import { JsonLd } from "@/components/json-ld";
import { brandName, type Settings } from "@/server/settings";
import { siteUrl } from "@/lib/utils";

/** Schema.org PetStore (LocalBusiness) — uniquement avec les informations réellement saisies. */
export function BusinessJsonLd({ s }: { s: Settings }) {
  const data: Record<string, unknown> = { "@context": "https://schema.org", "@type": "PetStore", name: brandName(s), url: siteUrl("/") };
  if (s.companyName) data.legalName = s.companyName;
  if (s.phone) data.telephone = s.phone;
  if (s.email) data.email = s.email;
  if (s.addressLine && s.city) data.address = { "@type": "PostalAddress", streetAddress: s.addressLine, postalCode: s.postalCode, addressLocality: s.city, addressCountry: s.country ?? "FR" };
  if (s.latitude && s.longitude) data.geo = { "@type": "GeoCoordinates", latitude: Number(s.latitude), longitude: Number(s.longitude) };
  if (s.siret) data.identifier = { "@type": "PropertyValue", propertyID: "SIRET", value: s.siret };
  const same = [s.instagram, s.facebook].filter(Boolean);
  if (same.length) data.sameAs = same;
  return <JsonLd data={data} />;
}
