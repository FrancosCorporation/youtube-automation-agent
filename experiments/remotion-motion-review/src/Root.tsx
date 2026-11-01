import { MyComposition } from "./Composition";
import { IceComposition } from "./IceComposition";
import { PulsoStoryComposition } from "./PulsoStoryComposition";
import { NarrativeCompositeComposition } from "./NarrativeComposite";
import { GpsExplainerComposition } from "./GpsExplainerComposition";
import { GpsExplainerV2Compositions } from "./GpsExplainerV2";
import { AiAnswerExplainerCompositions } from "./AiAnswerExplainer";
import { NarrativeEpisodeComposition } from "./NarrativeEpisodeV2";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <IceComposition />
      <PulsoStoryComposition />
      <NarrativeCompositeComposition />
      <GpsExplainerComposition />
      <GpsExplainerV2Compositions />
      <AiAnswerExplainerCompositions />
      <NarrativeEpisodeComposition />
    </>
  );
};
