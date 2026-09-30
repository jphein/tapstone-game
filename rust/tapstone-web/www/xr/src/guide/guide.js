// guide/guide.js: the guide's brain (guide v2). Pure: no IWSDK, no DOM, every clock passed in.
//
// It keeps what the person has done in this match (the history: the journal's taps on a resume, then
// every gesture), reads the facts from each view, keeps first-five's beat on the first beat not yet done
// (never back), and turns the beat into the lesson for this moment (guide/lesson.js). tick() says when
// the lesson's sentence should be spoken: when the lesson changes, or when its beat asks for a reminder.
// Every lesson spoken goes in `log` with contradicts()'s verdict, which the IWER gates read.
import { FirstFive } from '../logic/first-five.js';
import { contradicts, factsFrom, firstUndone, historyFrom, lessonFor } from './lesson.js';

export class Guide {
  constructor({ beats = new FirstFive() } = {}) {
    this.beats = beats;
    this.history = new Set();
    this.placed = false;
    this.lesson = { id: 'wait' };
    this.key = null;
    this.log = []; // [{ at, beat, id, say, why, round, active }]
  }

  start(now) {
    this.beats.start(now);
  }

  // A resumed match: what the journal says the person already did.
  resume(taps) {
    for (const k of historyFrom(taps)) this.history.add(k);
  }

  // A gesture the person made ('place', 'claim', or a committed move's kind from gestureOf).
  gesture(kind, now) {
    if (!kind) return;
    this.history.add(kind);
    if (kind === 'place') this.placed = true;
    this.beats.gesture(kind, now);
  }

  // A payoff seen in the views (first-five's beatEvents).
  event(kind, now) {
    this.beats.event(kind, now);
  }

  get done() {
    return this.beats.done;
  }

  // Each frame. ctx: { view, near, menu, hand, ready }. Returns { lesson, say } where `say` is the sentence to
  // queue now, or null.
  // ctx.ready === false: #200's first-run offer is still waiting for an answer. The guide starts after
  // the person chooses how to play, so until then it says nothing and moves no beat.
  tick(ctx, now) {
    if (ctx.ready === false) return { lesson: (this.lesson = { id: 'wait' }), say: null };
    const facts = factsFrom({ view: ctx.view, near: ctx.near, history: this.history, placed: this.placed });
    this.beats.sync(firstUndone(facts), now);
    const remind = this.beats.poll(now); // a watching beat's clock, or an unanswered beat's reminder
    const beat = this.beats.beat?.id ?? null;
    const lesson = beat ? lessonFor(beat, ctx) : { id: 'done' };
    const key = `${lesson.id}|${lesson.say ?? ''}|${JSON.stringify(lesson.demo ?? null)}`;
    const changed = key !== this.key;
    this.key = key;
    this.lesson = lesson;
    const speak = lesson.say && (changed ? `${lesson.id}|${lesson.say}` !== this.spoken : !!remind);
    if (!speak) return { lesson, say: null };
    this.spoken = `${lesson.id}|${lesson.say}`;
    const why = contradicts(lesson, { ...ctx, facts });
    this.log.push({ at: Math.round(now), beat, id: lesson.id, say: lesson.say, why, round: ctx.view?.round ?? null, active: ctx.view?.active ?? null });
    if (this.log.length > 200) this.log.shift();
    return { lesson, say: lesson.say };
  }
}
