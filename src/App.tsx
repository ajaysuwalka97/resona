import { useResonaSession } from "./hooks/useResonaSession";
import { ResonaStage } from "./ui/ResonaStage";

export function App() {
  const session = useResonaSession();
  return <ResonaStage {...session} />;
}
