import MarketClient from "./MarketClient";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function Page({ params }: PageProps) {
  const { slug } = await params;

  return <MarketClient slug={slug} />;
}