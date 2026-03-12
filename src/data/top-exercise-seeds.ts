export interface ExerciseSeedGroup {
  muscleGroup: string;
  exerciseNames: string[];
}

export const TOP_EXERCISE_SEEDS_BY_MUSCLE_GROUP: ExerciseSeedGroup[] = [
  {
    muscleGroup: 'chest',
    exerciseNames: [
      'Bench Press',
      'Incline Bench Press',
      'Decline Bench Press',
      'Dumbbell Bench Press',
      'Incline Dumbbell Press',
      'Chest Fly',
      'Pec Deck Fly',
      'Push-Up',
      'Cable Crossover',
      'Dips',
    ],
  },
  {
    muscleGroup: 'back',
    exerciseNames: [
      'Pull-Up',
      'Chin-Up',
      'Lat Pulldown',
      'Barbell Row',
      'Seated Cable Row',
      'One-Arm Dumbbell Row',
      'T-Bar Row',
      'Deadlift',
      'Hyperextension',
      'Straight-Arm Pulldown',
    ],
  },
  {
    muscleGroup: 'shoulders',
    exerciseNames: [
      'Overhead Press',
      'Dumbbell Shoulder Press',
      'Arnold Press',
      'Lateral Raise',
      'Front Raise',
      'Rear Delt Fly',
      'Upright Row',
      'Face Pull',
      'Shrug',
      'Machine Shoulder Press',
    ],
  },
  {
    muscleGroup: 'arms',
    exerciseNames: [
      'Barbell Curl',
      'Dumbbell Curl',
      'Hammer Curl',
      'Concentration Curl',
      'Preacher Curl',
      'Triceps Pushdown',
      'Skull Crusher',
      'Overhead Triceps Extension',
      'Close-Grip Bench Press',
      'Cable Triceps Kickback',
    ],
  },
  {
    muscleGroup: 'legs_quads_glutes',
    exerciseNames: [
      'Back Squat',
      'Front Squat',
      'Goblet Squat',
      'Leg Press',
      'Walking Lunge',
      'Split Squat',
      'Bulgarian Split Squat',
      'Step-Up',
      'Hack Squat',
      'Sumo Squat',
    ],
  },
  {
    muscleGroup: 'legs_hamstrings_calves',
    exerciseNames: [
      'Romanian Deadlift',
      'Stiff-Leg Deadlift',
      'Leg Curl',
      'Glute Bridge',
      'Hip Thrust',
      'Good Morning',
      'Kettlebell Swing',
      'Calf Raise',
      'Seated Calf Raise',
      'Donkey Calf Raise',
    ],
  },
  {
    muscleGroup: 'core',
    exerciseNames: [
      'Plank',
      'Side Plank',
      'Crunch',
      'Bicycle Crunch',
      'Hanging Leg Raise',
      'Russian Twist',
      'Mountain Climber',
      'Dead Bug',
      'Ab Wheel Rollout',
      'V-Up',
    ],
  },
  {
    muscleGroup: 'full_body_conditioning',
    exerciseNames: [
      'Burpee',
      'Thruster',
      'Clean and Press',
      'Snatch',
      'Kettlebell Clean',
      'Battle Rope Slam',
      'Rowing Machine Sprint',
      'Jump Rope',
      'Box Jump',
      "Farmer's Walk",
    ],
  },
];

export function getTopExerciseSeedNames(limit: number): string[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 80;
  const seen = new Set<string>();
  const names: string[] = [];

  for (const group of TOP_EXERCISE_SEEDS_BY_MUSCLE_GROUP) {
    for (const name of group.exerciseNames) {
      const trimmed = name.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }

      seen.add(trimmed);
      names.push(trimmed);
    }
  }

  return names.slice(0, normalizedLimit);
}
