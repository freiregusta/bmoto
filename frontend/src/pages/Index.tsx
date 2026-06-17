import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { StatsBar } from "@/components/landing/StatsBar";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Products } from "@/components/landing/Products";
import { ForRetailers } from "@/components/landing/ForRetailers";
import { Cases } from "@/components/landing/Cases";
import { Faq } from "@/components/landing/Faq";
import { CtaFooter } from "@/components/landing/CtaFooter";

const Index = () => (
  <div className="min-h-screen bg-background">
    <Nav />
    <main>
      <Hero />
      <StatsBar />
      <HowItWorks />
      <Products />
      <ForRetailers />
      <Cases />
      <Faq />
    </main>
    <CtaFooter />
  </div>
);

export default Index;
