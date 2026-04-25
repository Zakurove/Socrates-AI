/**
 * Seed: Headache — History Taking
 *
 * A reference-quality history-taking station used as a template for what a
 * well-built Socrates AI station looks like. Builds a classic 34-year-old
 * woman with migraine with aura presenting to the ED, covering SOCRATES,
 * SNOOP red flags, PMH / DH / FH / SH, ICE, and closure, followed by a
 * short examiner Q&A.
 *
 * Run manually (from project root, with .env set up for a local DB):
 *
 *   tsx --env-file=.env server/seeds/station-headache.ts <userId>
 *
 * If <userId> is omitted, defaults to 1 (the founder's usual local user).
 *
 * The script is idempotent-ish: it inserts a new station each run. If you
 * want a single canonical copy, delete older duplicates from the UI first.
 */

import { storage } from "../storage.js";
import {
  createStationSchema,
  type CreateStationPayload,
} from "../../shared/schema.js";

export const headacheStationPayload: CreateStationPayload = {
  title: "Headache — History Taking",
  type: "history_taking",
  hasPatientBriefing: true,
  aiPatientEnabled: true,
  defaultTimeMinutes: 8,
  readingTimeMinutes: 1,
  specialty: "Neurology",
  difficulty: "intermediate",
  tags: ["Neurology", "History Taking", "Emergency", "Headache"],
  scenario:
    "You are a doctor in the emergency department. A 34-year-old woman, Sarah Mitchell, presents with a 2-day history of severe headache. Take a focused history. You will be asked questions by the examiner at the end.",
  patientBriefing: [
    "You are Sarah Mitchell, a 34-year-old graduate student. You have come to the emergency department because of a severe headache that started 2 days ago.",
    "",
    "Opening line (say only this when the doctor first asks what brought you in): \"I've had this awful headache for two days now and it's not going away. I'm really worried — my aunt had a stroke.\"",
    "",
    "Answer questions clearly but do not volunteer information unless asked directly. Be calm but anxious. Use lay language, not medical terms.",
    "",
    "History of presenting complaint (give these details only when asked the matching question):",
    "- Site: right-sided, behind and above the eye, sometimes spreads to the right temple. Not the whole head.",
    "- Onset: came on gradually over about an hour. Not a sudden thunderclap. Not the worst headache of your life — severe, but it built up.",
    "- Character: throbbing, pulsating. Like a drum beating.",
    "- Radiation: spreads from behind the right eye to the right temple. Does not go to the neck, jaw or arm.",
    "- Associated symptoms: feel nauseous, vomited twice yesterday. Light hurts your eyes (you dimmed the ED lights). Loud noise makes it worse. Before the headache started you saw 'shimmery zigzag lines' in your vision for about 20 minutes — they went away before the pain started. No weakness, no numbness, no trouble speaking, no loss of consciousness, no seizures, no fever, no neck stiffness, no rash, no recent head injury.",
    "- Timing: episodic. You get headaches like this roughly once a month, usually lasting 1 to 2 days. This one feels similar to previous ones but more severe. No headache at night waking you up.",
    "- Exacerbating: bright light, loud noise, bending over, climbing stairs. Movement makes it worse.",
    "- Relieving: lying still in a dark quiet room helps a bit. You took ibuprofen but it did not help this time.",
    "- Severity: 8 out of 10.",
    "",
    "Red flag screen (answer NO to all of these unless asked): no fever, no weight loss, no rash, no focal weakness, no vision loss (only the brief zigzags before the headache), no seizures, no altered consciousness, no sudden thunderclap onset, no headache worse on coughing or straining, no headache waking you from sleep, no recent head trauma, no new headache pattern (you've had similar but milder attacks before), no headache on lying flat that gets worse.",
    "",
    "Past medical history: generally well. No hypertension, no diabetes, no cancer, no HIV, no previous head injury. You have had similar but milder headaches since you were a teenager — you just called them 'bad headaches' and never saw a doctor about them.",
    "",
    "Drug history: combined oral contraceptive pill (Microgynon) for 3 years. Ibuprofen and paracetamol as needed for headaches, maybe 4-5 days per month. No regular opioids. No anticoagulants. No recent new medications. No known drug allergies.",
    "",
    "Family history: your mother had migraines. Your aunt (mother's sister) had a stroke at age 62. No known brain aneurysms or subarachnoid hemorrhage in the family.",
    "",
    "Social history: you are a graduate student in molecular biology. You live with your partner. You drink about 3 cups of coffee a day. You drink 2-3 glasses of wine on weekends. You do not smoke. No recreational drugs. You have been sleeping poorly — 5 to 6 hours a night — and you are stressed about an upcoming thesis deadline.",
    "",
    "ICE:",
    "- Ideas: you think this might be a stroke because your aunt had one.",
    "- Concerns: you are worried something serious is happening in your brain. You are also worried about missing your thesis deadline.",
    "- Expectations: you want the pain to stop and you want someone to tell you it is not a stroke.",
    "",
    "Style rules:",
    "- Short, natural answers. 1-2 sentences at a time unless asked to elaborate.",
    "- Do not list your entire history in one go. Only answer what is asked.",
    "- If the doctor asks an open question like 'tell me more', give a little more but stay natural.",
    "- You are not a medical professional. Do not use words like 'photophobia', 'aura', 'unilateral'. Say 'light hurts my eyes', 'zigzag lines', 'one side'.",
    "- Hidden diagnosis: migraine with aura. Never volunteer this.",
  ].join("\n"),

  sections: [
    // 1. Introduction & Rapport
    {
      title: "Introduction & Rapport",
      order: 0,
      description: null,
      items: [
        {
          text: "Washes hands / applies alcohol gel",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "Basic infection control. Expected at the start of any patient encounter.",
          subItems: [],
          media: [],
        },
        {
          text: "Introduces self (name and role)",
          isCritical: false,
          points: 1,
      order: 1,
          explanation:
            "Sets the tone and opens the therapeutic relationship. Name + role + level of training is standard.",
          subItems: [],
          media: [],
        },
        {
          text: "Confirms patient identity (name and date of birth)",
          isCritical: true,
          points: 1,
      order: 2,
          explanation:
            "Patient safety step. Two identifiers are the minimum standard before any clinical encounter.",
          subItems: [],
          media: [],
        },
        {
          text: "Explains purpose of the consultation and gains consent",
          isCritical: false,
          points: 1,
      order: 3,
          explanation:
            "Consent is continuous, but stating the purpose up front orients the patient and respects autonomy.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 2. Presenting Complaint
    {
      title: "Presenting Complaint",
      order: 1,
      description: null,
      items: [
        {
          text: "Opens with a broad question (e.g., \"What brings you in today?\")",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "An open question invites the patient's own narrative and often yields the diagnosis before a single closed question is needed.",
          subItems: [],
          media: [],
        },
        {
          text: "Allows the patient to speak uninterrupted (golden minute)",
          isCritical: false,
          points: 1,
      order: 1,
          explanation:
            "The first 60 seconds of uninterrupted patient speech typically contain the key diagnostic information. Interrupting too early shuts down the narrative and misses cues.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 3. History of Presenting Illness (SOCRATES)
    {
      title: "History of Presenting Illness (SOCRATES)",
      order: 2,
      description:
        "Structured pain history using the SOCRATES mnemonic: Site, Onset, Character, Radiation, Associated symptoms, Timing, Exacerbating/relieving, Severity.",
      items: [
        {
          text: "Site — where is the headache?",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "Location narrows the differential. Unilateral frontotemporal suggests migraine; bilateral band-like suggests tension-type; periorbital with autonomic features suggests cluster; temporal in older patients raises giant cell arteritis.",
          subItems: [
            {
              text: "Clarifies unilateral vs bilateral",
              isCritical: false,
              points: 1,
      order: 0,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Clarifies region (frontal / temporal / occipital / periorbital)",
              isCritical: false,
              points: 1,
      order: 1,
              explanation: null,
              subItems: [],
              media: [],
            },
          ],
          media: [],
        },
        {
          text: "Onset — when and how did it start?",
          isCritical: true,
          points: 1,
      order: 1,
          explanation:
            "A sudden thunderclap onset reaching peak intensity within seconds to a minute is a red flag for subarachnoid hemorrhage until proven otherwise. Gradual onset over minutes to hours is more consistent with primary headache.",
          subItems: [
            {
              text: "Asks specifically about sudden / thunderclap onset",
              isCritical: true,
              points: 2,
      order: 0,
              explanation:
                "Directly screens for subarachnoid hemorrhage. A 'worst headache of life' peaking in under one minute mandates urgent imaging.",
              subItems: [],
              media: [],
            },
            {
              text: "Clarifies time to peak intensity",
              isCritical: false,
              points: 1,
      order: 1,
              explanation: null,
              subItems: [],
              media: [],
            },
          ],
          media: [],
        },
        {
          text: "Character — what does the pain feel like?",
          isCritical: false,
          points: 1,
      order: 2,
          explanation:
            "Throbbing / pulsating suggests migraine. Tight band / pressing suggests tension-type. Sharp, stabbing, boring behind one eye suggests cluster.",
          subItems: [
            {
              text: "Throbbing / pulsating",
              isCritical: false,
              points: 1,
      order: 0,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Tight band / pressing",
              isCritical: false,
              points: 1,
      order: 1,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Sharp / stabbing / boring",
              isCritical: false,
              points: 1,
      order: 2,
              explanation: null,
              subItems: [],
              media: [],
            },
          ],
          media: [],
        },
        {
          text: "Radiation — does the pain go anywhere else?",
          isCritical: false,
          points: 1,
      order: 3,
          explanation:
            "Radiation to the neck may suggest meningeal irritation. Radiation to the jaw with chewing raises giant cell arteritis in an older patient.",
          subItems: [],
          media: [],
        },
        {
          text: "Associated symptoms",
          isCritical: false,
          points: 1,
      order: 4,
          explanation:
            "Classic migraine features: nausea, vomiting, photophobia, phonophobia, aura. Autonomic features (lacrimation, conjunctival injection, ptosis, rhinorrhoea) suggest cluster. Fever and neck stiffness raise meningitis.",
          subItems: [
            {
              text: "Nausea and vomiting",
              isCritical: false,
              points: 1,
      order: 0,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Photophobia",
              isCritical: false,
              points: 1,
      order: 1,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Phonophobia",
              isCritical: false,
              points: 1,
      order: 2,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Visual aura (zigzags, scotoma, flashing lights)",
              isCritical: false,
              points: 2,
      order: 3,
              explanation:
                "Aura is a fully reversible focal neurological symptom, typically visual, preceding or accompanying the headache. Presence of aura changes management (e.g., contraindicates combined oral contraception due to stroke risk).",
              subItems: [],
              media: [],
            },
            {
              text: "Autonomic features (tearing, nasal congestion, ptosis)",
              isCritical: false,
              points: 1,
      order: 4,
              explanation:
                "Unilateral cranial autonomic symptoms point to trigeminal autonomic cephalalgias, of which cluster headache is the prototype.",
              subItems: [],
              media: [],
            },
          ],
          media: [],
        },
        {
          text: "Timing — episodic vs continuous, duration, frequency",
          isCritical: false,
          points: 1,
      order: 5,
          explanation:
            "Migraine attacks last 4-72 hours untreated. Cluster attacks are shorter (15-180 minutes) but in clusters. Chronic daily headache (>15 days/month) raises medication overuse. Progressive daily headache raises a space-occupying lesion.",
          subItems: [
            {
              text: "Duration of this attack",
              isCritical: false,
              points: 1,
      order: 0,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Frequency of similar attacks",
              isCritical: false,
              points: 1,
      order: 1,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "First ever vs similar previous episodes",
              isCritical: false,
              points: 1,
      order: 2,
              explanation: null,
              subItems: [],
              media: [],
            },
          ],
          media: [],
        },
        {
          text: "Exacerbating and relieving factors",
          isCritical: false,
          points: 1,
      order: 6,
          explanation:
            "Worse on movement and with bright light or loud sound supports migraine. Worse on coughing, straining, or lying flat suggests raised intracranial pressure. Worse on sitting up / better on lying flat suggests low-pressure headache (e.g., post-LP).",
          subItems: [
            {
              text: "Movement / physical activity",
              isCritical: false,
              points: 1,
      order: 0,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Light and sound",
              isCritical: false,
              points: 1,
      order: 1,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Rest / dark quiet room / sleep",
              isCritical: false,
              points: 1,
      order: 2,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Response to analgesia taken so far",
              isCritical: false,
              points: 1,
      order: 3,
              explanation: null,
              subItems: [],
              media: [],
            },
          ],
          media: [],
        },
        {
          text: "Severity — 0 to 10 pain score",
          isCritical: false,
          points: 1,
      order: 7,
          explanation:
            "A numerical score anchors severity and allows tracking over time. It does not, on its own, distinguish primary from secondary headache.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 4. Red Flag Screen (SNOOP)
    {
      title: "Red Flag Screen (SNOOP)",
      order: 3,
      description:
        "Systematic screen for features of secondary headache: Systemic, Neurological, Onset, Older, Pattern/Progressive/Positional/Precipitated.",
      items: [
        {
          text: "Systemic symptoms and secondary risk factors (fever, weight loss, rash, immunocompromise, malignancy)",
          isCritical: true,
          points: 2,
      order: 0,
          explanation:
            "Fever with headache and neck stiffness raises meningitis. Weight loss and night sweats raise malignancy or giant cell arteritis. Known HIV or immunosuppression widens the differential to opportunistic CNS infections and lymphoma.",
          subItems: [],
          media: [],
        },
        {
          text: "Neurological symptoms (focal weakness, numbness, vision loss, speech disturbance, seizures, altered consciousness)",
          isCritical: true,
          points: 2,
      order: 1,
          explanation:
            "Persistent focal neurological deficit or reduced GCS points to stroke, hemorrhage, space-occupying lesion, or encephalitis. Aura should fully resolve; a deficit that does not resolve is not migraine aura.",
          subItems: [],
          media: [],
        },
        {
          text: "Onset — sudden / thunderclap / worst headache of life",
          isCritical: true,
          points: 2,
      order: 2,
          explanation:
            "Screens for subarachnoid hemorrhage, arterial dissection, reversible cerebral vasoconstriction syndrome, and pituitary apoplexy.",
          subItems: [],
          media: [],
        },
        {
          text: "Older age — new-onset headache after 50",
          isCritical: true,
          points: 2,
      order: 3,
          explanation:
            "New headache over 50 raises giant cell arteritis and intracranial malignancy. Ask about jaw claudication, scalp tenderness, and visual disturbance.",
          subItems: [],
          media: [],
        },
        {
          text: "Pattern change, Progressive, Positional, or Precipitated by valsalva / cough",
          isCritical: true,
          points: 2,
      order: 4,
          explanation:
            "A change in established pattern, steady progression over weeks, headache that is worse on lying flat or on waking, or headache precipitated by cough / straining / valsalva all point to raised intracranial pressure and warrant imaging.",
          subItems: [
            {
              text: "Change from usual headache pattern",
              isCritical: false,
              points: 1,
      order: 0,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Progressive (worsening over days to weeks)",
              isCritical: false,
              points: 1,
      order: 1,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Positional (worse lying flat, on waking, or on standing)",
              isCritical: false,
              points: 1,
      order: 2,
              explanation: null,
              subItems: [],
              media: [],
            },
            {
              text: "Precipitated by cough, sneeze, valsalva or exertion",
              isCritical: false,
              points: 1,
      order: 3,
              explanation: null,
              subItems: [],
              media: [],
            },
          ],
          media: [],
        },
        {
          text: "Recent head trauma",
          isCritical: true,
          points: 2,
      order: 5,
          explanation:
            "Even minor trauma can cause subdural hematoma, particularly in the elderly or anticoagulated. Ask specifically — patients often do not volunteer it.",
          subItems: [],
          media: [],
        },
        {
          text: "Meningism (neck stiffness, photophobia, fever together)",
          isCritical: true,
          points: 2,
      order: 6,
          explanation:
            "Classic triad of meningitis. Photophobia alone is non-specific (common in migraine), but combined with fever and neck stiffness it mandates urgent assessment and empirical antibiotics if suspected.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 5. Past Medical History
    {
      title: "Past Medical History",
      order: 4,
      description: null,
      items: [
        {
          text: "Previous similar headaches or known migraine",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "A long history of stereotyped episodic attacks strongly supports primary headache. A first-ever severe headache or a clear change in pattern is a red flag.",
          subItems: [],
          media: [],
        },
        {
          text: "Hypertension",
          isCritical: false,
          points: 1,
      order: 1,
          explanation:
            "Poorly controlled hypertension is a risk factor for hemorrhagic stroke and hypertensive encephalopathy.",
          subItems: [],
          media: [],
        },
        {
          text: "Previous head injury or neurosurgery",
          isCritical: false,
          points: 1,
      order: 2,
          explanation:
            "Previous injury raises post-traumatic headache and chronic subdural hematoma. Previous shunts raise shunt dysfunction.",
          subItems: [],
          media: [],
        },
        {
          text: "Cancer (current or past)",
          isCritical: false,
          points: 1,
      order: 3,
          explanation:
            "Active or past malignancy raises cerebral metastases, particularly from lung, breast, melanoma, and renal primaries.",
          subItems: [],
          media: [],
        },
        {
          text: "HIV or immunocompromise",
          isCritical: false,
          points: 1,
      order: 4,
          explanation:
            "Widens the differential to CNS toxoplasmosis, cryptococcal meningitis, and CNS lymphoma.",
          subItems: [],
          media: [],
        },
        {
          text: "Pregnancy or recent pregnancy",
          isCritical: false,
          points: 1,
      order: 5,
          explanation:
            "Pregnancy and the postpartum period raise cerebral venous sinus thrombosis, eclampsia, and posterior reversible encephalopathy syndrome.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 6. Drug History
    {
      title: "Drug History",
      order: 5,
      description: null,
      items: [
        {
          text: "Regular prescribed medications",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "Establish baseline. Specifically note vasoactive and neurological medications.",
          subItems: [],
          media: [],
        },
        {
          text: "Hormonal contraception or HRT",
          isCritical: false,
          points: 2,
      order: 1,
          explanation:
            "Combined oral contraception is contraindicated in migraine with aura due to increased ischemic stroke risk. This is a key management-changing question in this patient.",
          subItems: [],
          media: [],
        },
        {
          text: "Frequency of analgesic use (screen for medication-overuse headache)",
          isCritical: false,
          points: 2,
      order: 2,
          explanation:
            "Simple analgesics used on 15 or more days per month, or triptans / opioids / combination analgesics on 10 or more days per month for more than 3 months, define medication-overuse headache. This is a common and treatable cause of chronic daily headache.",
          subItems: [],
          media: [],
        },
        {
          text: "Anticoagulants or antiplatelets",
          isCritical: false,
          points: 1,
      order: 3,
          explanation:
            "Lowers the threshold for imaging in headache with any trauma, and raises concern for intracranial hemorrhage.",
          subItems: [],
          media: [],
        },
        {
          text: "Recreational drugs (cocaine, amphetamines)",
          isCritical: false,
          points: 1,
      order: 4,
          explanation:
            "Sympathomimetic drugs are risk factors for intracerebral hemorrhage and reversible cerebral vasoconstriction syndrome.",
          subItems: [],
          media: [],
        },
        {
          text: "Allergies",
          isCritical: false,
          points: 1,
      order: 5,
          explanation:
            "Standard safety check before suggesting analgesia or antiemetics.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 7. Family History
    {
      title: "Family History",
      order: 6,
      description: null,
      items: [
        {
          text: "Migraine or recurrent headache in first-degree relatives",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "Migraine has a strong familial tendency. A positive family history supports the diagnosis.",
          subItems: [],
          media: [],
        },
        {
          text: "Subarachnoid hemorrhage or cerebral aneurysm",
          isCritical: false,
          points: 1,
      order: 1,
          explanation:
            "Two or more first-degree relatives with SAH or known berry aneurysms raises the individual's risk and changes the threshold for imaging.",
          subItems: [],
          media: [],
        },
        {
          text: "Stroke at a young age or polycystic kidney disease",
          isCritical: false,
          points: 1,
      order: 2,
          explanation:
            "Autosomal dominant polycystic kidney disease is associated with berry aneurysms. Young stroke in the family raises hereditary coagulopathies and CADASIL.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 8. Social History
    {
      title: "Social History",
      order: 7,
      description: null,
      items: [
        {
          text: "Occupation and impact on daily life",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "Headache frequency and severity are often best captured by the number of days missed from work or study.",
          subItems: [],
          media: [],
        },
        {
          text: "Stress and mood",
          isCritical: false,
          points: 1,
      order: 1,
          explanation:
            "Stress is a common migraine trigger and is also strongly associated with tension-type headache.",
          subItems: [],
          media: [],
        },
        {
          text: "Sleep pattern",
          isCritical: false,
          points: 1,
      order: 2,
          explanation:
            "Both insufficient and disrupted sleep are well-established migraine triggers.",
          subItems: [],
          media: [],
        },
        {
          text: "Caffeine intake",
          isCritical: false,
          points: 1,
      order: 3,
          explanation:
            "Caffeine excess and caffeine withdrawal both trigger headaches. Quantify cups per day.",
          subItems: [],
          media: [],
        },
        {
          text: "Alcohol",
          isCritical: false,
          points: 1,
      order: 4,
          explanation:
            "Alcohol, especially red wine, is a common migraine trigger.",
          subItems: [],
          media: [],
        },
        {
          text: "Smoking",
          isCritical: false,
          points: 1,
      order: 5,
          explanation:
            "Smoking plus combined oral contraception plus migraine with aura compounds stroke risk.",
          subItems: [],
          media: [],
        },
        {
          text: "Recreational drug use",
          isCritical: false,
          points: 1,
      order: 6,
          explanation:
            "Covered for completeness; ask in a non-judgmental way.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 9. ICE
    {
      title: "Ideas, Concerns, Expectations (ICE)",
      order: 8,
      description: null,
      items: [
        {
          text: "Ideas — what does the patient think is going on?",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "Exploring the patient's own model surfaces specific fears (e.g., stroke because a relative had one) that can then be addressed directly.",
          subItems: [],
          media: [],
        },
        {
          text: "Concerns — what is the patient most worried about?",
          isCritical: false,
          points: 1,
      order: 1,
          explanation:
            "Naming the worry allows you to address it explicitly rather than talking past it.",
          subItems: [],
          media: [],
        },
        {
          text: "Expectations — what does the patient want from this visit?",
          isCritical: false,
          points: 1,
      order: 2,
          explanation:
            "Aligns the plan with the patient's goals (pain relief, reassurance, investigation) and reduces later dissatisfaction.",
          subItems: [],
          media: [],
        },
      ],
    },

    // 10. Closure
    {
      title: "Closure",
      order: 9,
      description: null,
      items: [
        {
          text: "Summarises the history back to the patient",
          isCritical: false,
          points: 1,
      order: 0,
          explanation:
            "A brief summary checks understanding, corrects errors, and signals active listening.",
          subItems: [],
          media: [],
        },
        {
          text: "Offers the patient a chance to add anything else",
          isCritical: false,
          points: 1,
      order: 1,
          explanation:
            "'Is there anything else you wanted to tell me?' often surfaces the real concern that was held back.",
          subItems: [],
          media: [],
        },
        {
          text: "Explains next steps (examination, investigations, management plan)",
          isCritical: false,
          points: 1,
      order: 2,
          explanation:
            "Signposts the rest of the encounter and manages expectations.",
          subItems: [],
          media: [],
        },
        {
          text: "Thanks the patient",
          isCritical: false,
          points: 1,
      order: 3,
          explanation: "Basic courtesy. Expected in every encounter.",
          subItems: [],
          media: [],
        },
      ],
    },
  ],

  examinerQuestions: [
    {
      question: "What is your top differential and why?",
      idealAnswer:
        "Migraine with aura. The patient describes stereotyped, episodic, unilateral throbbing headaches lasting one to two days, associated with nausea, photophobia, and phonophobia, preceded by a fully reversible visual aura of shimmering zigzag lines. She has a long personal history of similar milder attacks, a positive family history in her mother, and classic triggers of poor sleep and stress. She has no red flag features: no thunderclap onset, no focal deficit, no fever or meningism, no progressive pattern, and she is under 50.",
      keyPoints: [
        "Names migraine with aura as the top differential",
        "Justifies using positive features (unilateral throbbing, aura, photophobia, phonophobia, episodic stereotyped attacks)",
        "Notes supportive history (family history of migraine, longstanding similar episodes, typical triggers)",
        "Explicitly rules out red flags for secondary headache",
      ],
      questionType: "free_text",
      order: 0,
    },
    {
      question:
        "List three red flags for secondary headache that you would worry about.",
      idealAnswer:
        "Any three of: sudden thunderclap onset (subarachnoid hemorrhage), new focal neurological deficit that does not resolve (stroke, space-occupying lesion), fever with neck stiffness and photophobia (meningitis), new-onset headache after age 50 (giant cell arteritis, malignancy), progressive headache worse on waking or with cough / valsalva (raised intracranial pressure), headache following recent head trauma (subdural hematoma), or systemic features such as weight loss, night sweats, or known immunocompromise.",
      keyPoints: [
        "Thunderclap / sudden onset",
        "Focal neurological deficit or altered consciousness",
        "Fever with meningism",
        "New-onset headache over 50",
        "Progressive / positional / precipitated by valsalva",
        "Recent head trauma",
      ],
      questionType: "free_text",
      order: 1,
    },
    {
      question:
        "What first-line investigations would you consider if you suspected subarachnoid hemorrhage?",
      idealAnswer:
        "Urgent non-contrast CT head within six hours of symptom onset — sensitivity approaches 100% at this window. If the CT is negative and clinical suspicion remains, proceed to lumbar puncture at least 12 hours after headache onset, looking for xanthochromia in the CSF supernatant. Baseline bloods should include full blood count, urea and electrolytes, coagulation screen, group and save, and a blood glucose. CT angiography is used to identify the aneurysm once subarachnoid hemorrhage is confirmed.",
      keyPoints: [
        "Urgent non-contrast CT head (ideally within 6 hours)",
        "Lumbar puncture at least 12 hours post-onset if CT negative, looking for xanthochromia",
        "Basic bloods: FBC, U&E, coagulation, group and save, glucose",
        "CT angiography to localise the aneurysm once confirmed",
      ],
      questionType: "free_text",
      order: 2,
    },
    {
      question: "What first-line acute treatment would you offer this patient?",
      idealAnswer:
        "For an acute migraine attack: a triptan such as sumatriptan, combined with a simple analgesic such as ibuprofen or aspirin, and an antiemetic such as metoclopramide or prochlorperazine, which also has an anti-migraine effect. Advise her to rest in a quiet, dark room. Safety-net with red flag advice and arrange follow-up. Importantly, because she has migraine with aura, the combined oral contraceptive pill should be stopped and an alternative form of contraception arranged, as it increases her ischemic stroke risk.",
      keyPoints: [
        "Triptan (e.g., sumatriptan)",
        "Simple analgesic (NSAID or aspirin)",
        "Antiemetic (metoclopramide or prochlorperazine)",
        "Conservative measures: rest in a dark quiet room",
        "Stop combined oral contraceptive — contraindicated in migraine with aura",
        "Safety-net and arrange follow-up",
      ],
      questionType: "free_text",
      order: 3,
    },
    {
      question: "When would you refer urgently to neurology?",
      idealAnswer:
        "Refer urgently or admit if there are red flag features: thunderclap onset, persistent focal neurological deficit, reduced level of consciousness, meningism, new-onset headache over 50, progressive headache, headache worse on waking or with valsalva, headache in pregnancy or the postpartum period, headache in an immunocompromised patient, or a significant change in the pattern of a pre-existing headache disorder. Routine neurology referral is appropriate for poorly controlled chronic migraine not responding to standard preventive therapy, for suspected cluster headache for specialist confirmation and preventive management, and for suspected medication-overuse headache where outpatient withdrawal support is needed.",
      keyPoints: [
        "Any red flag (thunderclap, focal deficit, meningism, progressive, new over 50)",
        "Headache in pregnancy / postpartum or immunocompromise",
        "Significant change from established headache pattern",
        "Chronic migraine unresponsive to first-line prevention",
        "Suspected cluster headache",
        "Medication-overuse headache needing withdrawal support",
      ],
      questionType: "free_text",
      order: 4,
    },
  ],
};

async function main() {
  // Validate the payload against the public create-station schema so we catch
  // shape errors before touching the DB.
  const parsed = createStationSchema.safeParse(headacheStationPayload);
  if (!parsed.success) {
    console.error(
      "[seed] Payload failed validation:",
      JSON.stringify(parsed.error.flatten(), null, 2),
    );
    process.exit(1);
  }

  const userIdArg = process.argv[2];
  const userId = userIdArg ? parseInt(userIdArg, 10) : 1;
  if (!Number.isFinite(userId) || userId <= 0) {
    console.error(`[seed] Invalid userId: ${userIdArg}`);
    process.exit(1);
  }

  console.log(
    `[seed] Inserting Headache history-taking station for userId=${userId}...`,
  );
  const station = await storage.createStation(userId, parsed.data);
  console.log(
    `[seed] Done. Station id=${station.id}, title="${station.title}", sections=${station.sections.length}, examinerQuestions=${station.examinerQuestions.length}`,
  );
}

// Only run main() when executed directly (not when imported).
// Compare against the resolved module URL of this file.
const isDirectRun =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed] Failed:", err);
      process.exit(1);
    });
}
