// @ts-check

const workouts = [
    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Café Spin</name>
    <category>Recovery</category>
    <description>Supple Zone 1 active recovery spin at 45-55% FTP to promote blood flow and clear residual fatigue between key training days.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="300" PowerLow="0.40" PowerHigh="0.50" Cadence="85"/>
        <SteadyState Duration="900" Power="0.50" Cadence="90">
            <textevent timeoffset="0" message="Light pressure on the pedals — keep your shoulders relaxed." duration="12"/>
        </SteadyState>
        <SteadyState Duration="600" Power="0.55" Cadence="92">
            <textevent timeoffset="0" message="Lift cadence slightly while keeping breathing effortless." duration="10"/>
        </SteadyState>
        <SteadyState Duration="600" Power="0.50" Cadence="88"/>
        <Cooldown Duration="300" PowerLow="0.50" PowerHigh="0.38" Cadence="85"/>
    </workout>
</workout_file>`,

    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Rouleur Base</name>
    <category>Endurance</category>
    <description>Foundational Zone 2 aerobic endurance session stepping smoothly between 65% and 73% FTP to build mitochondrial density and fat oxidation.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.65" Cadence="88"/>
        <SteadyState Duration="900" Power="0.65" Cadence="90">
            <textevent timeoffset="0" message="Settle into your endurance rhythm and sip fluids early." duration="12"/>
        </SteadyState>
        <SteadyState Duration="900" Power="0.70" Cadence="90"/>
        <SteadyState Duration="900" Power="0.73" Cadence="92">
            <textevent timeoffset="0" message="Upper Zone 2 — smooth torque all the way around the stroke." duration="12"/>
        </SteadyState>
        <SteadyState Duration="600" Power="0.66" Cadence="88"/>
        <Cooldown Duration="300" PowerLow="0.65" PowerHigh="0.42" Cadence="85"/>
    </workout>
</workout_file>`,

    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Flandrien Endurance</name>
    <category>Endurance</category>
    <description>75-minute cobble-country endurance ride blending steady Zone 2 cruising with controlled low-tempo rollers to build aerobic durability.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.68" Cadence="88"/>
        <SteadyState Duration="900" Power="0.68" Cadence="90"/>
        <SteadyState Duration="300" Power="0.80" Cadence="85">
            <textevent timeoffset="0" message="False-flat roller — stay seated and drive through the hips." duration="10"/>
        </SteadyState>
        <SteadyState Duration="900" Power="0.68" Cadence="90"/>
        <SteadyState Duration="300" Power="0.82" Cadence="85"/>
        <SteadyState Duration="900" Power="0.70" Cadence="90"/>
        <SteadyState Duration="300" Power="0.82" Cadence="86"/>
        <Cooldown Duration="300" PowerLow="0.65" PowerHigh="0.40" Cadence="85"/>
    </workout>
</workout_file>`,

    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Col du Galibier</name>
    <category>Sweet Spot</category>
    <description>Three 12-minute alpine sweet spot climbs at 88-92% FTP separated by 4-minute valley recoveries to raise muscular endurance below threshold.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75" Cadence="88"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="1.02" OffPower="0.52" Cadence="98" CadenceResting="85"/>
        <SteadyState Duration="120" Power="0.52" Cadence="85"/>
        <SteadyState Duration="720" Power="0.88" Cadence="88">
            <textevent timeoffset="0" message="Climb 1 of 3 — steady alpine cadence at 88% FTP." duration="12"/>
        </SteadyState>
        <SteadyState Duration="240" Power="0.50" Cadence="85"/>
        <SteadyState Duration="720" Power="0.90" Cadence="88">
            <textevent timeoffset="0" message="Climb 2 of 3 — nudge up to 90% FTP, stay aero on the hoods." duration="12"/>
        </SteadyState>
        <SteadyState Duration="240" Power="0.50" Cadence="85"/>
        <SteadyState Duration="720" Power="0.92" Cadence="90">
            <textevent timeoffset="0" message="Final climb at 92% FTP — smooth breathing to the summit." duration="12"/>
        </SteadyState>
        <Cooldown Duration="360" PowerLow="0.60" PowerHigh="0.40" Cadence="85"/>
    </workout>
</workout_file>`,

    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Contre-la-Montre 2x20</name>
    <category>Threshold</category>
    <description>Classic time-trial benchmark: two sustained 20-minute blocks at 98% FTP with a 6-minute spin between efforts to anchor threshold power.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75" Cadence="90"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="30" OnPower="1.06" OffPower="0.52" Cadence="100" CadenceResting="85"/>
        <SteadyState Duration="180" Power="0.50" Cadence="85"/>
        <SteadyState Duration="1200" Power="0.98" Cadence="92">
            <textevent timeoffset="0" message="First 20-minute chrono block — lock into race posture." duration="12"/>
            <textevent timeoffset="600" message="Halfway through block 1 — relax your grip and hold cadence." duration="10"/>
        </SteadyState>
        <SteadyState Duration="360" Power="0.50" Cadence="85">
            <textevent timeoffset="0" message="Drink up and reset before the second chrono effort." duration="12"/>
        </SteadyState>
        <SteadyState Duration="1200" Power="0.98" Cadence="92">
            <textevent timeoffset="0" message="Second 20-minute block — composed and even from the start." duration="12"/>
            <textevent timeoffset="900" message="Final 5 minutes — hold your line all the way to the finish." duration="10"/>
        </SteadyState>
        <Cooldown Duration="300" PowerLow="0.55" PowerHigh="0.38" Cadence="85"/>
    </workout>
</workout_file>`,

    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Échappée Over-Unders</name>
    <category>Over-Unders</category>
    <description>Breakaway lactate-shuttling workout: three 12-minute sets alternating 2 minutes at 94% FTP with 1-minute surges at 106% FTP.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.78" Cadence="90"/>
        <SteadyState Duration="120" Power="0.52" Cadence="85"/>
        <IntervalsT Repeat="4" OnDuration="120" OffDuration="60" OnPower="0.94" OffPower="1.06" Cadence="90" CadenceResting="96"/>
        <SteadyState Duration="240" Power="0.50" Cadence="85"/>
        <IntervalsT Repeat="4" OnDuration="120" OffDuration="60" OnPower="0.94" OffPower="1.06" Cadence="90" CadenceResting="96"/>
        <SteadyState Duration="240" Power="0.50" Cadence="85"/>
        <IntervalsT Repeat="4" OnDuration="120" OffDuration="60" OnPower="0.94" OffPower="1.06" Cadence="90" CadenceResting="96"/>
        <Cooldown Duration="360" PowerLow="0.58" PowerHigh="0.40" Cadence="85"/>
    </workout>
</workout_file>`,

    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Mur de Huy 5x4</name>
    <category>VO2max</category>
    <description>Five steep 4-minute VO2max climbs at 115% FTP paired with 4-minute Zone 1 recoveries to expand maximal aerobic ceiling.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75" Cadence="90"/>
        <IntervalsT Repeat="2" OnDuration="30" OffDuration="45" OnPower="1.12" OffPower="0.50" Cadence="100" CadenceResting="85"/>
        <SteadyState Duration="150" Power="0.50" Cadence="85"/>
        <IntervalsT Repeat="5" OnDuration="240" OffDuration="240" OnPower="1.15" OffPower="0.48" Cadence="96" CadenceResting="85"/>
        <Cooldown Duration="300" PowerLow="0.55" PowerHigh="0.38" Cadence="85"/>
    </workout>
</workout_file>`,

    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Critérium 40/20s</name>
    <category>VO2max</category>
    <description>High-cadence micro-intervals: two blocks of eight 40-second surges at 122% FTP with 20-second floats to keep oxygen uptake pinned.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75" Cadence="90"/>
        <IntervalsT Repeat="2" OnDuration="20" OffDuration="40" OnPower="1.18" OffPower="0.52" Cadence="102" CadenceResting="85"/>
        <SteadyState Duration="180" Power="0.50" Cadence="85"/>
        <IntervalsT Repeat="8" OnDuration="40" OffDuration="20" OnPower="1.22" OffPower="0.45" Cadence="98" CadenceResting="85"/>
        <SteadyState Duration="300" Power="0.48" Cadence="85"/>
        <IntervalsT Repeat="8" OnDuration="40" OffDuration="20" OnPower="1.22" OffPower="0.45" Cadence="98" CadenceResting="85"/>
        <Cooldown Duration="360" PowerLow="0.55" PowerHigh="0.38" Cadence="85"/>
    </workout>
</workout_file>`,

    `<workout_file>
    <author>Soigneur Studio</author>
    <name>Kermesse Attack</name>
    <category>Anaerobic</category>
    <description>Race-winning anaerobic repeatability and sprint snap: two sets of 30-second attacks at 145% FTP plus closing 15-second sprints at 175% FTP.</description>
    <sportType>bike</sportType>
    <workout>
        <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.75" Cadence="90"/>
        <IntervalsT Repeat="2" OnDuration="15" OffDuration="45" OnPower="1.35" OffPower="0.50" Cadence="105" CadenceResting="85"/>
        <SteadyState Duration="180" Power="0.50" Cadence="85"/>
        <IntervalsT Repeat="4" OnDuration="30" OffDuration="150" OnPower="1.45" OffPower="0.50" Cadence="105" CadenceResting="85"/>
        <SteadyState Duration="300" Power="0.52" Cadence="88"/>
        <IntervalsT Repeat="4" OnDuration="15" OffDuration="135" OnPower="1.75" OffPower="0.50" Cadence="112" CadenceResting="85"/>
        <Cooldown Duration="360" PowerLow="0.55" PowerHigh="0.38" Cadence="85"/>
    </workout>
</workout_file>`,
];

export { workouts };
