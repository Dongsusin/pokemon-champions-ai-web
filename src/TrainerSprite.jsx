import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import {
  getPlayerTrainerSpriteCandidates,
  getTrainerSpriteCandidates,
} from './data/trainerSprites.js'

function TrainerSprite({ trainer, isPlayer = false, playerGender = 'male', className = '', alt }) {
  const candidates = isPlayer
    ? getPlayerTrainerSpriteCandidates(playerGender)
    : getTrainerSpriteCandidates(trainer)
  const candidateKey = candidates.join('|')
  const [sourceIndex, setSourceIndex] = useState(0)

  useEffect(() => setSourceIndex(0), [candidateKey])

  const source = candidates[sourceIndex]

  if (!isPlayer && trainer?.portraitMembers?.length) return (
    <span className={['trainer-sprite-frame', 'trainer-portrait-group', className].filter(Boolean).join(' ')} role="img" aria-label={alt ?? trainer.name}>
      {trainer.portraitMembers.map((member, index) => <TrainerSprite key={index} trainer={member} />)}
    </span>
  )

  return (
    <span
      className={['trainer-sprite-frame', trainer?.id === 'factory-clown' && 'factory-trainer-portrait', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={alt ?? `${trainer?.name ?? '플레이어'} 트레이너`}
    >
      {source ? (
        <img
          src={source}
          alt=""
          aria-hidden="true"
          draggable="false"
          loading="eager"
          decoding="sync"
          onError={() => setSourceIndex((index) => index + 1)}
        />
      ) : (
        <UserRound aria-hidden="true" />
      )}
    </span>
  )
}

export default TrainerSprite
