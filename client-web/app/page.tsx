import { Navigation } from '@/components/landing/Navigation';
import { Hero } from '@/components/landing/Hero';
import { ProblemSolution } from '@/components/landing/ProblemSolution';
import { OneToOneMatching } from '@/components/landing/OneToOneMatching';
import { CoreFeatures } from '@/components/landing/CoreFeatures';
import { KnowledgeAsset } from '@/components/landing/KnowledgeAsset';
import { FinalCTA } from '@/components/landing/FinalCTA';

export default function LandingPage() {
  return (
    <main>
      <Navigation />
      <Hero />
      <OneToOneMatching />
      <ProblemSolution />
      <CoreFeatures />
      <KnowledgeAsset />
      <FinalCTA />
    </main>
  );
}
