import { useEffect, useRef, useState } from 'react';
import { MessagesSquare, MonitorUp, Volume2 } from 'lucide-react';
import { Coordinate } from '../components/primitives';
import { HavenWindow, type Scene } from '../product/HavenWindow';

const SCENES: Array<{ id: Scene; title: string; detail: string; Icon: typeof Volume2 }> = [
  { id: 'chat', title: 'Talk it through', detail: 'Channels with replies, reactions and custom emoji.', Icon: MessagesSquare },
  { id: 'voice', title: 'Drop into voice', detail: 'One click from the conversation into the room.', Icon: Volume2 },
  { id: 'share', title: 'Put your screen up', detail: 'Share a window and let people focus on it.', Icon: MonitorUp },
];

export function Product() {
  const [scene, setScene] = useState<Scene>('chat');
  const [active, setActive] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="product" className="station product" aria-labelledby="product-title">
      <div className="section-head product-head" data-calm="0.75">
        <Coordinate index="01">Haven</Coordinate>
        <h2 id="product-title" className="section-title reveal" data-arrival>
          Everything happens in one room.
        </h2>
        <p className="section-lede reveal">
          Talk in a channel, drop into voice and put your screen up without leaving the conversation or juggling apps.
        </p>
      </div>

      <div className="product-stage reveal" ref={stageRef}>
        <div className="scene-switch" role="group" aria-label="Try a moment in Haven">
          {SCENES.map(({ id, title, detail, Icon }, index) => (
            <button key={id} type="button" className="scene-step" aria-pressed={scene === id} onClick={() => setScene(id)}>
              <span className="scene-step-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="scene-step-copy">
                <span className="scene-step-title"><Icon size={16} strokeWidth={1.75} aria-hidden="true" />{title}</span>
                <span className="scene-step-detail">{detail}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="window-frame" data-calm="0.9">
          <HavenWindow scene={scene} onSceneChange={setScene} active={active} />
        </div>
        <p className="sample-note">Interactive sample. It runs entirely in this page: nothing you type is sent and no microphone or screen is used.</p>
      </div>
    </section>
  );
}
